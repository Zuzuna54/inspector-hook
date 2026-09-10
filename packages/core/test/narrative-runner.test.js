/**
 * The runner that actually ships (P11 follow-up).
 *
 * `buildNarrative` takes an injected runner so its gates, timeouts and failure
 * paths can be exercised without a model call. That is the right design — and
 * its cost is that `defaultRunner`, the code that runs when a user clicks
 * Summarise, was tested by nothing at all. Dependency injection tests the seam;
 * it does not test the implementation behind it.
 *
 * So these run the REAL runner against a fake `claude` on a temporary PATH. No
 * model is involved, and every property asserted is one the stub cannot fake
 * on the runner's behalf: that the prompt reaches stdin, that stdout comes
 * back, that a non-zero exit is reported rather than thrown, that a hang is
 * killed, and that a missing binary is a result rather than a crash.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { defaultRunner } from "../dist/index.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** A directory holding a fake `claude`, and a PATH that finds it. */
async function fakeClaude(script) {
	const dir = await mkdtemp(join(tmpdir(), "narrative-runner-"));
	dirs.push(dir);
	const bin = join(dir, "claude");
	// `#!/bin/sh`, an absolute path: the child's env is deliberately minimal,
	// so `#!/usr/bin/env bash` cannot resolve `bash` and every case fails with
	// exit 127 from the SHEBANG — which looks exactly like the runner failing
	// to find `claude`, and cost a wrong diagnosis to tell apart.
	await writeFile(bin, `#!/bin/sh\n${script}\n`, "utf-8");
	await chmod(bin, 0o755);
	// The fake dir FIRST, then the real PATH. A production child inherits the
	// user's environment, so a minimal one is both unrealistic and a trap: with
	// only the temp dir on PATH the script's own `cat`/`sed` are unfindable and
	// every case fails with exit 127, which looks identical to the runner
	// failing to find `claude`.
	return { dir, env: { PATH: `${dir}:${process.env.PATH ?? ""}` } };
}

const haveSh = spawnSync("/bin/sh", ["-c", "true"]).status === 0;

describe("the default runner", { skip: !haveSh }, () => {
	it("sends the prompt on stdin and returns what came back", async () => {
		// The prompt is piped, not passed as an argument — a digest body can be
		// thousands of characters and an argv has a hard ceiling.
		const { env } = await fakeClaude('cat | sed "s/^/saw:/"');
		const result = await defaultRunner("the digest body", {
			env,
			timeoutMs: 10_000,
		});
		assert.equal(result.code, 0);
		assert.equal(result.timedOut, false);
		assert.match(result.stdout, /saw:the digest body/);
	});

	it("carries the environment it is given to the child", async () => {
		const { env } = await fakeClaude('echo "$INSPECTOR_HOOK_DISABLED"');
		const result = await defaultRunner("x", {
			env: { ...env, INSPECTOR_HOOK_DISABLED: "1" },
			timeoutMs: 10_000,
		});
		// The whole reason `childEnv` exists: without this reaching the child,
		// `claude -p` fires the hooks and the core ingests its own subprocess.
		assert.equal(result.stdout.trim(), "1");
	});

	it("reports a non-zero exit rather than throwing", async () => {
		const { env } = await fakeClaude('echo "not logged in" >&2; exit 3');
		const result = await defaultRunner("x", { env, timeoutMs: 10_000 });
		assert.equal(result.code, 3);
		assert.match(result.stderr, /not logged in/);
		assert.equal(result.timedOut, false);
	});

	it("kills a child that hangs, and says it timed out", async () => {
		// Without this a session end waits on a process that never answers.
		const { env } = await fakeClaude("sleep 30");
		const started = Date.now();
		const result = await defaultRunner("x", { env, timeoutMs: 300 });
		const elapsed = Date.now() - started;
		assert.equal(result.timedOut, true);
		assert.ok(elapsed < 5_000, `waited ${elapsed}ms — the kill did not fire`);
	});

	it("returns a result when the binary is missing, rather than rejecting", async () => {
		// A rejection here would propagate out of buildNarrative's try and turn
		// an absent narrative into a failed digest.
		const result = await defaultRunner("x", {
			env: { PATH: "/definitely/not/here" },
			timeoutMs: 5_000,
		});
		assert.equal(result.code, null);
		assert.ok(result.stderr.length > 0, "the spawn error was swallowed");
	});

	it("collects output written in several chunks", async () => {
		// stdout arrives as a stream; a runner that read only the first chunk
		// would silently truncate every summary longer than a pipe buffer.
		const { env } = await fakeClaude('printf "one "; sleep 0.1; printf "two"');
		const result = await defaultRunner("x", { env, timeoutMs: 10_000 });
		assert.equal(result.stdout, "one two");
	});
});
