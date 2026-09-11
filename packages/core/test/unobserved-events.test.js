/**
 * The events that are registered and have never fired (M2.3, M5.2).
 *
 * Four audit rows sat at `untested` for the same reason: the hook is
 * registered, the core handles it, and nothing on this machine has ever
 * produced one. `StopFailure` needs a turn to fail; `TaskCreated` and
 * `TaskCompleted` need the task queue, which this user has never used. 23
 * `TeammateIdle` have arrived and 0 of the other two.
 *
 * "Registered and never observed" is a different thing from "handled and
 * unregistered" — the second is the inert-fix failure this project keeps
 * finding, and the first is just an absence of occasions. But the distinction
 * is only worth making if the path is known to work, and until now nothing
 * proved that: the evidence was a code read.
 *
 * So these drive the real payloads through the real HTTP server into the real
 * managers, and assert what lands. It does not make the events fire on this
 * machine — nothing can — but it removes the only part that was guesswork.
 */

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";

import {
	FileTracker,
	HttpServer,
	LogManager,
	PersistenceStore,
	SessionManager,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

let storagePath;
let server;
let port;
let logManager;

before(async () => {
	storagePath = await makeTempStore();
	const persistence = new PersistenceStore({ basePath: storagePath });
	await persistence.initialize();

	logManager = new LogManager({
		storagePath,
		maxLogsInMemory: 1000,
		retentionDays: 0,
		persistence,
	});
	server = new HttpServer({
		port: 0,
		logManager,
		sessionManager: new SessionManager({ storagePath, persistence }),
		fileTracker: new FileTracker({
			workspaceRoot: storagePath,
			storagePath,
			persistence,
		}),
	});
	await server.start();
	port = server.getPort();
});

after(async () => {
	await server?.stop();
	await cleanup(storagePath);
});

/** POST a NATIVE payload, exactly as a `"type": "http"` hook delivers it. */
async function fire(payload) {
	const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	assert.equal(res.status, 200, "a hook must always get a clean answer");
	const { logs } = await logManager.getLogs({
		pagination: { limit: 200, offset: 0 },
	});
	return logs;
}

const find = (logs, hook) => logs.find((l) => l.hook === hook);

describe("StopFailure (M2.3)", () => {
	it("lands as an error, under its own event name", async () => {
		const logs = await fire({
			hook_event_name: "StopFailure",
			session_id: "s-fail",
			prompt_id: "p-1",
			error: "the model timed out after 600s",
		});
		const entry = find(logs, "StopFailure");
		assert.ok(entry, "StopFailure must be ingested, not dropped as unknown");
		// `error`, so the Errors counter can populate. It was hardcoded "info"
		// once, which is why that counter could never move.
		assert.equal(entry.level, "error");
		assert.equal(entry.event, "ai.error");
		assert.match(entry.message, /the model timed out/);
	});

	it("keeps its error text out of the field Stop uses for a reply", async () => {
		// Stop carries the finished reply in `last_assistant_message`;
		// StopFailure reuses that field for the error string. Sharing an event
		// name would file a failure as a successful response.
		const logs = await fire({
			hook_event_name: "Stop",
			session_id: "s-fail",
			prompt_id: "p-2",
			last_assistant_message: "here is the answer",
		});
		const stop = find(logs, "Stop");
		const failure = find(logs, "StopFailure");
		assert.equal(stop.event, "ai.response");
		assert.equal(stop.level, "info");
		assert.notEqual(stop.event, failure.event);
		assert.equal(stop.details.lastAssistantMessage, "here is the answer");
	});
});

describe("the task events (M5.2)", () => {
	it("ingests TaskCreated", async () => {
		const logs = await fire({
			hook_event_name: "TaskCreated",
			session_id: "s-task",
			prompt_id: "p-3",
		});
		const entry = find(logs, "TaskCreated");
		assert.ok(entry, "TaskCreated must be ingested");
		// Not renamed: only the events the core keys on are mapped, and an event
		// the platform adds must not be given a name the core silently ignores.
		assert.equal(entry.event, "TaskCreated");
		assert.equal(entry.level, "info");
	});

	it("ingests TaskCompleted", async () => {
		const logs = await fire({
			hook_event_name: "TaskCompleted",
			session_id: "s-task",
			prompt_id: "p-4",
		});
		const entry = find(logs, "TaskCompleted");
		assert.ok(entry);
		assert.equal(entry.event, "TaskCompleted");
	});

	it("ingests TeammateIdle, the one of the three that does fire here", async () => {
		const logs = await fire({
			hook_event_name: "TeammateIdle",
			session_id: "s-task",
			prompt_id: "p-5",
		});
		assert.ok(find(logs, "TeammateIdle"));
	});

	it("keeps the three apart rather than collapsing them", async () => {
		const { logs } = await logManager.getLogs({
			pagination: { limit: 200, offset: 0 },
		});
		const names = new Set(logs.map((l) => l.hook));
		for (const hook of ["TaskCreated", "TaskCompleted", "TeammateIdle"]) {
			assert.ok(names.has(hook), `${hook} is missing from the store`);
		}
	});
});

describe("an event the platform has not invented yet", () => {
	it("is stored under its own name rather than discarded", async () => {
		// The reason the rename table is a whitelist. A future event that the
		// core does not key on must still be captured, or the first anyone
		// hears of it is a gap in the history.
		const logs = await fire({
			hook_event_name: "SomeFutureEvent",
			session_id: "s-future",
			prompt_id: "p-6",
		});
		const entry = find(logs, "SomeFutureEvent");
		assert.ok(entry, "an unknown hook must not be dropped");
		assert.equal(entry.event, "SomeFutureEvent");
	});
});
