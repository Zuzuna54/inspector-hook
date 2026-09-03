/**
 * Regressions for the second round of fixes (B9-B12), found by a parallel
 * audit rather than by running the app:
 *   B9  - compareVersions could not compare against the live file on disk
 *   B10 - sessions.delete/clear reported deletions they never performed
 *   B11 - the HTTP server advertised open CORS to any web page
 *   B12 - deleteVersion left versionCount permanently inflated
 */

import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	FileTracker,
	HttpServer,
	LogManager,
	PersistenceStore,
	SessionManager,
} from "../dist/index.js";
import { cleanup, makeLog, makeTempStore } from "./helpers.js";

const tempDirs = [];

async function newTracker() {
	const storagePath = await makeTempStore();
	tempDirs.push(storagePath);
	const persistence = new PersistenceStore({ basePath: storagePath });
	await persistence.initialize();
	return {
		storagePath,
		tracker: new FileTracker({
			workspaceRoot: storagePath,
			storagePath,
			persistence,
		}),
	};
}

after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

describe("REGRESSION B9: compare a stored version against the live file", () => {
	it("diffs a version against current disk content", async () => {
		const { tracker, storagePath } = await newTracker();
		const file = join(storagePath, "live.txt");

		await tracker.addVersion(file, "stored content\n", { sessionId: "s1" });
		// The file on disk has since moved on from the stored version.
		await writeFile(file, "live content\n", "utf-8");

		const result = await tracker.compareVersions(file, 1, "current");

		assert.ok(result, "comparison must not silently return null");
		assert.ok(result.diff.hunks.length > 0, "should report a difference");
	});

	it("accepts the aliases the UI actually sends", async () => {
		const { tracker, storagePath } = await newTracker();
		const file = join(storagePath, "live.txt");
		await tracker.addVersion(file, "v1\n", { sessionId: "s1" });
		await writeFile(file, "v2\n", "utf-8");

		// history.js sends the literal string "disk"; CoreBridge's type says
		// "current"; -1 is the internal sentinel. All must work.
		for (const alias of ["current", "disk", "live", -1]) {
			const result = await tracker.compareVersions(file, 1, alias);
			assert.ok(result, `alias ${alias} should resolve to the live file`);
		}
	});

	it("returns numeric version identifiers, never the raw alias", async () => {
		const { tracker, storagePath } = await newTracker();
		const file = join(storagePath, "live.txt");
		await tracker.addVersion(file, "v1\n", { sessionId: "s1" });
		await writeFile(file, "v2\n", "utf-8");

		const result = await tracker.compareVersions(file, 1, "current");
		assert.equal(typeof result.version1, "number");
		assert.equal(typeof result.version2, "number");
	});

	it("returns null when the file does not exist on disk", async () => {
		const { tracker, storagePath } = await newTracker();
		const file = join(storagePath, "never-written.txt");
		await tracker.addVersion(file, "stored\n", { sessionId: "s1" });

		assert.equal(await tracker.compareVersions(file, 1, "current"), null);
	});
});

describe("REGRESSION B10: session deletion reports only real deletions", () => {
	it("delete() no longer claims to remove file changes it cannot reach", async () => {
		const storagePath = await makeTempStore();
		tempDirs.push(storagePath);
		const mgr = new SessionManager({ storagePath });

		mgr.trackActivity("s1", makeLog({ sessionId: "s1" }));
		mgr.addFileChange("s1", "change-1");
		mgr.addFileChange("s1", "change-2");

		const result = await mgr.delete("s1");

		assert.equal(result.deletedSessions, 1);
		// SessionManager owns no changes; the cascade is IpcServer's job. It must
		// report 0 rather than the session's change-count.
		assert.equal(result.deletedFileChanges, 0);
		assert.equal(result.deletedLogs, 0);
	});
});

describe("REGRESSION B11: HTTP server refuses browser-originated requests", () => {
	let server;
	let port;
	let storagePath;

	const start = async () => {
		storagePath = await makeTempStore();
		tempDirs.push(storagePath);
		const persistence = new PersistenceStore({ basePath: storagePath });
		await persistence.initialize();
		server = new HttpServer({
			port: 0,
			logManager: new LogManager({
				storagePath,
				maxLogsInMemory: 100,
				retentionDays: 7,
				persistence,
			}),
			sessionManager: new SessionManager({ storagePath, persistence }),
			fileTracker: new FileTracker({
				workspaceRoot: storagePath,
				storagePath,
				persistence,
			}),
		});
		await server.start();
		port = server.getPort();
	};

	after(async () => {
		await server?.stop();
	});

	it("rejects a request carrying an Origin header", async () => {
		await start();
		const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
			headers: { Origin: "http://evil.example" },
		});
		assert.equal(res.status, 403, "browser-initiated requests must be refused");
	});

	it("does not advertise a permissive CORS policy", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/health`);
		assert.equal(res.headers.get("access-control-allow-origin"), null);
	});

	it("still accepts ordinary hook requests with no Origin", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/health`);
		assert.equal(res.status, 200);
		assert.equal((await res.json()).status, "healthy");
	});
});

describe("REGRESSION B12: deleteVersion keeps versionCount consistent", () => {
	it("decrements the count when a version is removed", async () => {
		const { tracker, storagePath } = await newTracker();
		const file = join(storagePath, "counted.txt");

		await tracker.addVersion(file, "one", { sessionId: "s1" });
		await tracker.addVersion(file, "two", { sessionId: "s1" });
		await tracker.addVersion(file, "three", { sessionId: "s1" });
		assert.equal((await tracker.getVersions(file)).versionCount, 3);

		await tracker.deleteVersion(file, 2);

		const history = await tracker.getVersions(file);
		assert.equal(
			history.versionCount,
			history.versions.length,
			"versionCount must match the versions actually retained",
		);
	});
});
