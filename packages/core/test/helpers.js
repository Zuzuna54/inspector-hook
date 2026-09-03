/**
 * Shared test helpers.
 *
 * Tests run against the built bundle in dist/ rather than the TypeScript
 * sources. That keeps the test suite dependency-free (no ts-node, no transpiler)
 * and exercises exactly the artifact that ships.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create an isolated storage directory for one test. */
export async function makeTempStore() {
	return mkdtemp(join(tmpdir(), "inspector-hook-test-"));
}

/** Remove a temp directory, ignoring errors. */
export async function cleanup(dir) {
	await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Build a log entry of the shape HttpServer/LogManager produce, so manager
 * tests exercise the same field names the real ingest path uses.
 */
export function makeLog(overrides = {}) {
	return {
		id: `log-${Math.random().toString(36).slice(2)}`,
		timestamp: new Date().toISOString(),
		level: "info",
		hook: "PreToolUse",
		event: "PreToolUse",
		message: "test",
		...overrides,
	};
}

/** Wait for the event loop to drain pending microtasks/timers. */
export function tick(ms = 10) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
