/**
 * One collector, so every path builds the same digest.
 *
 * Three call sites each assembled a DigestInput by hand and two of them
 * assembled less: `collapseSession` and `writeSessionMemory` passed a bare
 * session, so the digest written into the user's memory -- and, worse, the
 * summary preserved permanently during retention -- carried no counts and no
 * resolved file paths, while the preview the panel showed for the same session
 * carried both. The durable record was the degraded one.
 *
 * These tests are behavioural: they run the collector and read the rendered
 * body. The one source-level assertion here is a NEGATIVE property (nothing
 * builds a digest without the collector), which is the only kind a source-text
 * check can state honestly -- a positive claim about output has to be made
 * against output.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildSessionDigest, collectDigestInput } from "../dist/index.js";

/** A session with enough activity that the digest is worth keeping. */
function session(overrides = {}) {
	return {
		id: "1f7c9a2e-0000-4000-8000-abcdefabcdef",
		name: "inspector-hook",
		status: "completed",
		startTime: "2026-09-04T10:00:00.000Z",
		endTime: "2026-09-04T10:42:00.000Z",
		metadata: {
			projectName: "inspector-hook",
			gitBranch: "milestone-0-harden",
			workingDirectory: "/repo",
		},
		toolExecutions: [{ tool: "Edit", status: "completed", affectedFiles: [] }],
		fileChanges: ["c1", "c2", "gone"],
		...overrides,
	};
}

/** A log source returning exactly the rows given. */
function logsReturning(rows) {
	return { getLogs: async () => ({ logs: rows }) };
}

/** A change source that resolves c1/c2 and knows nothing about anything else. */
const changes = {
	getChangeById: async (id) =>
		({ c1: { filePath: "/repo/a.ts" }, c2: { filePath: "/repo/b.ts" } })[id] ??
		null,
};

const row = (over = {}) => ({
	level: "info",
	hook: "PostToolUse",
	timestamp: "2026-09-04T10:01:00.000Z",
	details: {},
	...over,
});

describe("collectDigestInput", () => {
	it("resolves change IDs to paths and skips the ones that are gone", async () => {
		const input = await collectDigestInput({ session: session(), changes });
		assert.deepEqual(input.filePaths, ["/repo/a.ts", "/repo/b.ts"]);
	});

	it("counts errors, warnings, blocked and total logs in one pass", async () => {
		const input = await collectDigestInput({
			session: session(),
			logs: logsReturning([
				row({ level: "error" }),
				row({ level: "error" }),
				row({ level: "warn" }),
				row({ level: "blocked" }),
				row({ level: "info" }),
			]),
		});
		assert.deepEqual(input.counts, {
			errors: 2,
			warnings: 1,
			blocked: 1,
			logs: 5,
		});
	});

	it("collects prompts oldest first, deduped", async () => {
		const input = await collectDigestInput({
			session: session(),
			logs: logsReturning([
				row({
					hook: "UserPromptSubmit",
					timestamp: "2026-09-04T10:30:00.000Z",
					details: { prompt: "second" },
				}),
				row({
					hook: "UserPromptSubmit",
					timestamp: "2026-09-04T10:05:00.000Z",
					details: { prompt: "first" },
				}),
				row({
					hook: "UserPromptSubmit",
					timestamp: "2026-09-04T10:40:00.000Z",
					details: { prompt: "first" },
				}),
			]),
		});
		assert.deepEqual(input.prompts, ["first", "second"]);
	});

	it("takes replies from Stop and never from StopFailure", async () => {
		// Both write to details.lastAssistantMessage, but StopFailure's value is
		// an API error. Recording it would put "API Error: rate limit reached"
		// into native memory as something the session concluded.
		const input = await collectDigestInput({
			session: session(),
			logs: logsReturning([
				row({
					hook: "Stop",
					timestamp: "2026-09-04T10:10:00.000Z",
					details: { lastAssistantMessage: "Fixed the parser." },
				}),
				row({
					hook: "StopFailure",
					timestamp: "2026-09-04T10:20:00.000Z",
					details: { lastAssistantMessage: "API Error: rate limit reached" },
				}),
			]),
		});
		assert.deepEqual(input.replies, ["Fixed the parser."]);
	});

	it("survives a log source that throws, rather than losing the digest", async () => {
		const input = await collectDigestInput({
			session: session(),
			logs: {
				getLogs: async () => {
					throw new Error("store unavailable");
				},
			},
			changes,
		});
		assert.deepEqual(input.counts, {
			errors: 0,
			warnings: 0,
			blocked: 0,
			logs: 0,
		});
		// The half that did work is still there.
		assert.deepEqual(input.filePaths, ["/repo/a.ts", "/repo/b.ts"]);
	});

	it("returns a usable input with no sources at all", async () => {
		const input = await collectDigestInput({ session: session() });
		assert.deepEqual(input.prompts, []);
		assert.deepEqual(input.replies, []);
		assert.deepEqual(input.filePaths, []);
	});
});

describe("the digest a collected input produces", () => {
	async function digestWith(rows) {
		return buildSessionDigest(
			await collectDigestInput({
				session: session(),
				logs: logsReturning(rows),
				changes,
			}),
		);
	}

	it("carries the session id", async () => {
		// Its absence was a shipped bug: the panel's "Stage this" guarded on
		// digest.sessionId, a field that had never existed, so the button did
		// nothing for as long as it shipped.
		const digest = await digestWith([]);
		assert.equal(digest.sessionId, session().id);
	});

	it("names the real files rather than reporting unresolved changes", async () => {
		const digest = await digestWith([]);
		assert.match(digest.body, /## Files changed \(2\)/);
		assert.match(digest.body, /`\/repo\/a\.ts`/);
		assert.doesNotMatch(digest.description, /paths unresolved/);
	});

	it("renders prompts, replies and log counts", async () => {
		const digest = await digestWith([
			row({ level: "error" }),
			row({
				hook: "UserPromptSubmit",
				details: { prompt: "make the parser handle CRLF" },
			}),
			row({
				hook: "Stop",
				timestamp: "2026-09-04T10:30:00.000Z",
				details: { lastAssistantMessage: "Handled CRLF in the tokenizer." },
			}),
		]);
		assert.match(digest.body, /## What was asked/);
		assert.match(digest.body, /make the parser handle CRLF/);
		assert.match(digest.body, /## What was concluded/);
		assert.match(digest.body, /Handled CRLF in the tokenizer\./);
		assert.match(digest.body, /- Log entries: 3/);
		assert.match(digest.body, /- Errors logged: 1/);
	});

	it("is strictly richer than the bare-session digest it replaced", async () => {
		// The actual regression, stated as a comparison: the old call sites
		// passed only a session, and this asserts what that cost.
		const bare = buildSessionDigest({ session: session() });
		const collected = await digestWith([row({ level: "error" })]);

		assert.match(bare.description, /paths unresolved/);
		assert.doesNotMatch(collected.description, /paths unresolved/);
		assert.doesNotMatch(bare.body, /Errors logged/);
		assert.match(collected.body, /Errors logged/);
	});
});

describe("nothing builds a digest without the collector", () => {
	it("no src module calls buildSessionDigest on a bare session", async () => {
		// A negative property, which is what a source-level check can state
		// honestly. If a fourth call site appears and passes only a session, it
		// silently reintroduces the two-tier digest this file exists to prevent,
		// and no behavioural test would catch it because the weak digest is
		// still a valid digest.
		const { readdir, readFile } = await import("node:fs/promises");
		const { join, resolve, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

		const files = [];
		const walk = async (dir) => {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) await walk(full);
				else if (entry.name.endsWith(".ts")) files.push(full);
			}
		};
		await walk(srcRoot);
		assert.ok(files.length > 5, "found the source tree");

		const offenders = [];
		for (const file of files) {
			// Comments stripped first: this file's own explanations name the
			// pattern, and a check that matches its own prose can only be
			// satisfied by rewording it.
			const code = (await readFile(file, "utf-8"))
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			// `buildSessionDigest({ session })` or `({ session: x })` with no
			// other key — the exact shape that drops counts and paths.
			if (/buildSessionDigest\(\{\s*session(?::\s*\w+)?\s*,?\s*\}\)/.test(code)) {
				offenders.push(file);
			}
		}
		assert.deepEqual(offenders, [], "these build a digest without collectDigestInput");
	});
});
