/**
 * No bundled hook emits a shape Claude Code ignores.
 *
 * Fourteen of them did. Every one emitted `additionalContext` at the TOP LEVEL:
 *
 *     {"additionalContext": "..."}          <- parsed, then discarded
 *     {"hookSpecificOutput": {...}}         <- the one that works
 *
 * That is measured rather than read off documentation. A probe hook emitted
 * BOTH shapes in a single JSON object on one UserPromptSubmit; only the nested
 * sentinel reached the model, and it reached two independent sessions at once.
 * So the top-level form has been doing nothing, silently, for as long as these
 * hooks have existed — the most expensive kind of bug here, because a hook that
 * fails loudly gets fixed and one that returns 0 and injects nothing does not.
 *
 * Per event, and the distinction matters more than the nesting:
 *
 *   UserPromptSubmit, PreToolUse, PostToolUse, SubagentStop
 *       nested hookSpecificOutput.additionalContext with a matching
 *       hookEventName
 *   SessionStart
 *       RAW STDOUT. Two documentation sources disagree about whether it takes
 *       additionalContext or systemMessage; this repo does not have to pick,
 *       because packages/hooks/claude/inspector-context.sh prints plain text on
 *       SessionStart and is verified working end to end.
 *   SessionEnd, PreCompact
 *       no injection field at all. Anything printed as JSON is discarded, so
 *       those hooks say what they did on stderr instead of pretending.
 */

import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hookRoots = [
	join(repoRoot, "config", "claude-hooks"),
	join(repoRoot, "packages", "hooks", "claude"),
];

/** Every hook script under the scanned roots. */
async function hookFiles(dir, out = []) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__pycache__") continue;
			await hookFiles(full, out);
		} else if (/\.(sh|py)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

async function allHooks() {
	const out = [];
	for (const root of hookRoots) await hookFiles(root, out);
	return out;
}

/**
 * Strip comments before looking at code.
 *
 * These files explain the bug in prose directly above the fix, so a check over
 * raw text would match its own explanation and could only be satisfied by
 * rewording it — backwards.
 */
function codeOnly(text, file) {
	return file.endsWith(".py")
		? text.replace(/^\s*#.*$/gm, "")
		: text.replace(/^\s*#.*$/gm, "");
}

describe("bundled hook output shapes", () => {
	it("finds the hooks", async () => {
		// Without this the sweep could cover nothing and pass.
		const files = await allHooks();
		assert.ok(files.length > 10, `only found ${files.length} hook scripts`);
	});

	it("never emits additionalContext at the top level", async () => {
		// The whole finding, as one assertion. A top-level emission is ignored on
		// EVERY event, so there is no case where it is the right thing to write.
		const offenders = [];
		for (const file of await allHooks()) {
			const code = codeOnly(await readFile(file, "utf-8"), file);
			if (!code.includes("additionalContext")) continue;
			if (!code.includes("hookSpecificOutput")) {
				offenders.push(relative(repoRoot, file));
			}
		}
		assert.deepEqual(
			offenders,
			[],
			"these emit a shape Claude Code parses and discards",
		);
	});

	it("names the event whenever it nests", async () => {
		// `hookSpecificOutput` without a matching `hookEventName` is as inert as
		// the top-level form, and looks more correct — which is worse.
		const offenders = [];
		for (const file of await allHooks()) {
			const code = codeOnly(await readFile(file, "utf-8"), file);
			if (!code.includes("hookSpecificOutput")) continue;
			if (!code.includes("hookEventName")) offenders.push(relative(repoRoot, file));
		}
		assert.deepEqual(offenders, [], "nested output with no hookEventName is still ignored");
	});

	it("keeps the SessionStart injector on raw stdout", async () => {
		// The one mechanism this repo has verified end to end. If it ever grows a
		// JSON wrapper, that is a change of mechanism and should be deliberate.
		const src = await readFile(
			join(repoRoot, "packages", "hooks", "claude", "inspector-context.sh"),
			"utf-8",
		);
		assert.ok(
			!codeOnly(src, "x").includes("hookSpecificOutput"),
			"SessionStart injection switched to a JSON shape without measuring it",
		);
	});

	it("keeps the UserPromptSubmit injector nested, with its event named", async () => {
		const src = await readFile(
			join(repoRoot, "packages", "hooks", "claude", "inspector-prompt-context.sh"),
			"utf-8",
		);
		assert.match(src, /hookSpecificOutput/);
		assert.match(src, /hookEventName.*UserPromptSubmit/);
	});
});
