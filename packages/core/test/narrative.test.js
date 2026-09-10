/**
 * The optional prose narrative (P11).
 *
 * Every path here runs with an INJECTED runner. Nothing in this file calls a
 * model, which is the point: success, non-zero exit, timeout, empty output, a
 * throwing runner and a missing binary all have to be exercised, and none of
 * them is reachable if the only way to test the module is to spend a model
 * call and hope it fails the right way.
 *
 * Three properties carry it:
 *
 * 1. **Three independent gates**, all of them, every time. Each answers a
 *    different question and collapsing any two makes one unaskable.
 * 2. **The child env must carry `INSPECTOR_HOOK_DISABLED=1`.** `claude -p`
 *    fires the installed hooks, so without it the core ingests its own
 *    subprocess and the corpus turns self-referential — slowly, invisibly, and
 *    in a way every count in the panel would then include.
 * 3. **A failure is never an empty narrative.** It is a stated reason, and the
 *    facts stand untouched.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	buildNarrative,
	childEnv,
	claudeOnPath,
	MAX_NARRATIVE_CHARS,
	MAX_PROMPT_CHARS,
	narrativePrompt,
	withNarrative,
} from "../dist/index.js";

const BODY =
	"## What changed\n\n- src/a.ts\n\n## What was asked\n\n- fix the thing";

/** A runner that returns whatever it is told, and records how it was called. */
function runner(result, calls = []) {
	return async (prompt, options) => {
		calls.push({ prompt, options });
		return { stdout: "", stderr: "", code: 0, timedOut: false, ...result };
	};
}

/** Options with all three gates open, so a test can close exactly one. */
function open(over = {}) {
	return {
		narrative: true,
		env: { INSPECTOR_HOOK_NARRATIVE: "1", PATH: "/usr/bin" },
		hasClaude: () => true,
		runner: runner({ stdout: "It refactored the thing and it worked." }),
		...over,
	};
}

describe("the three gates", () => {
	it("does nothing unless the CALL asks for it", async () => {
		// The most specific gate, and the one most callers never open.
		for (const narrative of [undefined, false]) {
			const r = await buildNarrative(BODY, open({ narrative }));
			assert.equal(r.text, undefined);
			assert.equal(r.gate, "call");
			assert.match(r.reason, /not requested/i);
		}
	});

	it("does nothing unless the MACHINE is opted in", async () => {
		const r = await buildNarrative(BODY, open({ env: { PATH: "/usr/bin" } }));
		assert.equal(r.text, undefined);
		assert.equal(r.gate, "env");
		assert.match(r.reason, /INSPECTOR_HOOK_NARRATIVE=1/);
	});

	it("does nothing unless `claude` is on PATH", async () => {
		const r = await buildNarrative(BODY, open({ hasClaude: () => false }));
		assert.equal(r.text, undefined);
		assert.equal(r.gate, "binary");
		assert.match(r.reason, /not on PATH/);
	});

	it("needs ALL THREE, not any of them", async () => {
		// Collapsing two would make one unaskable: an env var alone runs it for
		// every session forever; a call flag alone spends model calls on a
		// machine whose operator never agreed to it.
		const calls = [];
		const r = await buildNarrative(
			BODY,
			open({ runner: runner({ stdout: "prose" }, calls) }),
		);
		assert.equal(r.text, "prose");
		assert.equal(
			calls.length,
			1,
			"the runner was not reached with all gates open",
		);
	});

	it("never runs the runner when any gate is closed", async () => {
		for (const closed of [
			{ narrative: false },
			{ env: { PATH: "/usr/bin" } },
			{ hasClaude: () => false },
		]) {
			const calls = [];
			await buildNarrative(
				BODY,
				open({ ...closed, runner: runner({}, calls) }),
			);
			assert.equal(
				calls.length,
				0,
				`a closed gate still spawned: ${JSON.stringify(closed)}`,
			);
		}
	});
});

describe("the child environment", () => {
	it("always carries INSPECTOR_HOOK_DISABLED=1", () => {
		// The negative property this module exists to hold. Without it the
		// narrative call produces tool events, which become logs, which become
		// research items, which the next narrative call then summarises.
		assert.equal(childEnv({}).INSPECTOR_HOOK_DISABLED, "1");
		assert.equal(childEnv({ PATH: "/x" }).INSPECTOR_HOOK_DISABLED, "1");
	});

	it("overrides an inherited value rather than passing it through", async () => {
		// A parent that had it set to 0 must not be able to re-enable ingestion
		// inside the child.
		assert.equal(
			childEnv({ INSPECTOR_HOOK_DISABLED: "0" }).INSPECTOR_HOOK_DISABLED,
			"1",
		);
	});

	it("reaches the runner on a real call", async () => {
		const calls = [];
		await buildNarrative(
			BODY,
			open({ runner: runner({ stdout: "x" }, calls) }),
		);
		assert.equal(calls[0].options.env.INSPECTOR_HOOK_DISABLED, "1");
	});

	it("keeps the rest of the environment", () => {
		// The child still needs PATH and whatever else `claude` reads.
		assert.equal(childEnv({ PATH: "/usr/bin", HOME: "/h" }).HOME, "/h");
	});
});

describe("failures are stated, never empty", () => {
	it("reports a timeout as a timeout", async () => {
		const r = await buildNarrative(
			BODY,
			open({
				runner: runner({ timedOut: true, code: null }),
				timeoutMs: 5_000,
			}),
		);
		assert.equal(r.text, undefined);
		assert.match(r.reason, /did not answer within 5s/);
	});

	it("reports a non-zero exit, with the first line of stderr", async () => {
		const r = await buildNarrative(
			BODY,
			open({
				runner: runner({ code: 2, stderr: "not logged in\nstack trace…" }),
			}),
		);
		assert.equal(r.text, undefined);
		assert.match(r.reason, /exited 2/);
		assert.match(r.reason, /not logged in/);
		assert.ok(
			!r.reason.includes("stack trace"),
			"the whole stderr was pasted in",
		);
	});

	it("reports an empty answer rather than an empty section", async () => {
		// A zero exit with no output is a real state, and rendering it as a
		// heading with nothing under it looks like the model had nothing to say.
		const r = await buildNarrative(
			BODY,
			open({ runner: runner({ stdout: "   \n" }) }),
		);
		assert.equal(r.text, undefined);
		assert.match(r.reason, /returned nothing/);
	});

	it("survives a runner that throws", async () => {
		// A narrative failure must never be able to cost a digest.
		const r = await buildNarrative(
			BODY,
			open({
				runner: async () => {
					throw new Error("spawn ENOENT");
				},
			}),
		);
		assert.equal(r.text, undefined);
		assert.match(r.reason, /spawn ENOENT/);
	});

	it("refuses an empty digest body", async () => {
		const r = await buildNarrative("   ", open());
		assert.equal(r.text, undefined);
		assert.match(r.reason, /no body/);
	});
});

describe("the prompt", () => {
	it("carries the facts and forbids repeating them", async () => {
		const prompt = narrativePrompt(BODY);
		assert.ok(prompt.includes(BODY), "the record was not sent");
		assert.match(prompt, /Do not repeat/i);
		assert.match(prompt, /Do not invent/i);
	});

	it("tells it to say so rather than guess", async () => {
		// The digest's whole guarantee is that it says nothing untrue. A
		// narrative that guesses at intent would undo that in the same file.
		assert.match(narrativePrompt(BODY), /instead of guessing/i);
	});

	it("bounds what is sent", () => {
		const huge = "x".repeat(MAX_PROMPT_CHARS * 3);
		assert.ok(narrativePrompt(huge).length < MAX_PROMPT_CHARS + 1_000);
	});
});

describe("attaching it to the digest", () => {
	it("leaves the facts first and untouched", async () => {
		const out = withNarrative(BODY, { text: "It worked." });
		assert.ok(out.startsWith("## What changed"), "the facts were displaced");
		assert.ok(out.includes("- src/a.ts"), "a fact was lost");
	});

	it("labels the prose as generated and as an interpretation", async () => {
		// A reader has to be able to tell which half was recorded and which half
		// was written by a model, at a glance, in the file itself.
		const out = withNarrative(BODY, { text: "It worked." });
		assert.match(out, /## Summary \(generated\)/);
		assert.match(out, /interpretation/i);
	});

	it("changes nothing when there is no narrative", async () => {
		// The facts-only fallback, which is the normal case.
		assert.equal(withNarrative(BODY, { reason: "off" }), BODY);
		assert.equal(withNarrative(BODY, {}), BODY);
	});

	it("caps the prose", async () => {
		const r = await buildNarrative(
			BODY,
			open({ runner: runner({ stdout: "y".repeat(MAX_NARRATIVE_CHARS * 2) }) }),
		);
		assert.equal(r.text.length, MAX_NARRATIVE_CHARS);
	});
});

describe("finding the binary", () => {
	it("says no when PATH is empty rather than throwing", () => {
		assert.equal(claudeOnPath({}), false);
		assert.equal(claudeOnPath({ PATH: "" }), false);
	});

	it("says no for a directory that does not exist", () => {
		assert.equal(claudeOnPath({ PATH: "/definitely/not/here" }), false);
	});
});

describe("it is never automatic", () => {
	// A NEGATIVE property — "nothing on the session-end path asks for one" —
	// which is what a source assertion is for. A behavioural test can only show
	// that one path it happens to call does not; it cannot show that no path
	// does. The plan's rule: source-text assertions for negative properties,
	// behavioural tests for positive ones.
	const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
	const read = (rel) => readFileSync(join(srcDir, rel), "utf-8");

	it("core.ts never asks for a narrative", () => {
		// `core.ts` builds digests on `session:ended` and during retention
		// collapse. A model call on either is a cost that accrues with nobody
		// watching, and it would be invisible until a bill or a rate limit.
		assert.ok(
			!/buildNarrative|narrative:\s*true/.test(read("core.ts")),
			"core.ts requests a narrative — session end must never spend a model call",
		);
	});

	it("only the explicit IPC path calls it", () => {
		const callers = [];
		for (const rel of [
			"core.ts",
			"ipc/ipc-server.ts",
			"memory/session-digest.ts",
			"memory/digest-input.ts",
			"memory/staged-context.ts",
			"context/find-service.ts",
		]) {
			if (/\bbuildNarrative\(/.test(read(rel))) callers.push(rel);
		}
		assert.deepEqual(
			callers,
			["ipc/ipc-server.ts"],
			"a narrative is requested from somewhere other than the explicit IPC path",
		);
	});

	it("the digest builder itself stays deterministic", () => {
		// `session-digest.ts` guarantees a memory file says nothing untrue. It
		// stays purely deterministic; the prose is attached afterwards, by a
		// caller that opted in.
		//
		// Comments are stripped first. The file HAS a comment about narratives
		// — explaining that there is deliberately no model call in it — and a
		// check that matched its own explanation would fail on the very thing
		// it is asserting.
		const code = read("memory/session-digest.ts")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		assert.ok(
			!/buildNarrative|narrative\.js/.test(code),
			"the digest builder calls a model",
		);
	});
});
