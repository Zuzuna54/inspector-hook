/**
 * Generate the payload fixtures the webview tests assert against.
 *
 * The webview suite had 278 green assertions while three shipped bugs sat in
 * the Context view, because every fixture was invented. `context-view.test.js`
 * asserted `renderDigest({sessionId, worthKeeping, text})` -- a shape the
 * backend has never produced, since the real digest field is `body`, carried no
 * `sessionId` at all, and arrived wrapped in an IPC envelope. The tests pinned
 * an imagined contract and the renderer matched the imagination.
 *
 * So the fixtures are generated from the REAL builders here, in the package
 * that already compiles `dist/` before it tests, and checked in. The webview
 * suite only ever reads the file, so it keeps its no-dependency, eval-the-
 * shipped-scripts model.
 *
 * The important detail: fixtures record what the HANDLER returns, not what the
 * builder returns. The gap between those two is precisely where B1 and B2
 * lived.
 *
 * Regenerate with:  node test/generate-fixtures.js
 * `fixtures.test.js` fails if the checked-in copy has drifted.
 */

import { buildSessionDigest, collectDigestInput } from "../dist/index.js";

/** A session with real activity, so the digest is worth keeping. */
const ACTIVE_SESSION = {
	id: "1f7c9a2e-0000-4000-8000-abcdefabcdef",
	name: "inspector-hook",
	status: "completed",
	startTime: "2026-09-04T10:00:00.000Z",
	endTime: "2026-09-04T10:42:00.000Z",
	metadata: {
		projectName: "inspector-hook",
		gitBranch: "milestone-0-harden",
		workingDirectory: "/repo",
		transcriptPath: "/repo/.claude/projects/repo/transcript.jsonl",
	},
	toolExecutions: [
		{ tool: "Edit", status: "completed", affectedFiles: ["/repo/a.ts"] },
		{ tool: "Bash", status: "failed", affectedFiles: [] },
	],
	fileChanges: ["c1", "c2"],
};

/** A session that recorded nothing, which the digest declines to keep. */
const EMPTY_SESSION = {
	id: "00000000-0000-4000-8000-000000000000",
	name: "scratch",
	status: "completed",
	startTime: "2026-09-04T09:00:00.000Z",
	endTime: "2026-09-04T09:01:00.000Z",
	metadata: { projectName: "scratch" },
	toolExecutions: [],
	fileChanges: [],
};

const LOGS = [
	{ level: "error", hook: "PostToolUse", timestamp: "2026-09-04T10:01:00.000Z", details: {} },
	{
		level: "info",
		hook: "UserPromptSubmit",
		timestamp: "2026-09-04T10:02:00.000Z",
		details: { prompt: "make the parser handle CRLF" },
	},
	{
		level: "info",
		hook: "Stop",
		timestamp: "2026-09-04T10:30:00.000Z",
		details: { lastAssistantMessage: "Handled CRLF in the tokenizer." },
	},
];

const logs = { getLogs: async () => ({ logs: LOGS }) };
const changes = {
	getChangeById: async (id) =>
		({ c1: { filePath: "/repo/a.ts" }, c2: { filePath: "/repo/b.ts" } })[id] ?? null,
};

export async function buildFixtures() {
	const digest = buildSessionDigest(
		await collectDigestInput({ session: ACTIVE_SESSION, logs, changes }),
	);
	const emptyDigest = buildSessionDigest(
		await collectDigestInput({ session: EMPTY_SESSION }),
	);

	// What ipc-server.ts returns for memory.buildDigest, verbatim.
	const digestEnvelope = { digest, written: false };
	const emptyEnvelope = { digest: emptyDigest, written: false };

	// What panel.ts forwards to the webview after unwrapping. This is the
	// shape every renderer test must use, and the shape the old fixtures got
	// wrong.
	const { digest: inner, ...outcome } = digestEnvelope;
	const digestPayload = { ...inner, ...outcome };
	const { digest: emptyInner, ...emptyOutcome } = emptyEnvelope;
	const emptyDigestPayload = { ...emptyInner, ...emptyOutcome };

	return {
		// memory.buildDigest, before and after the boundary unwrap.
		digestEnvelope,
		digestPayload,
		emptyDigestPayload,
		digestError: { error: "No session nope." },

		// memory.stageContext: both branches. The refusal is a DIFFERENT shape
		// from a StagedContext, which is why storing it as one drew a success
		// box over an empty body.
		stagedOk: {
			staged: true,
			text: digest.body,
			stagedAt: "2026-09-04T11:00:00.000Z",
			expiresAt: "2026-09-04T12:00:00.000Z",
			sourceSessionId: ACTIVE_SESSION.id,
			label: digest.title,
		},
		stagedRefusal: {
			staged: false,
			reason: "no file changes and no tool executions",
		},

		// The mutating memory methods, every result shape they actually return.
		results: {
			written: { written: true, path: "/m/session-2026-09-04.md", indexUpdated: true },
			writeRefused: {
				written: false,
				refused: "not-authored-by-us",
				reason: "notes.md was not written by Inspector Hook.",
			},
			deleted: { deleted: true },
			deleteRefused: { deleted: false, reason: "notes.md was not written by us." },
			indexed: { indexed: true, changed: true },
			indexRefused: { indexed: false, reason: "No such file: ghost.md" },
			// The success shape that used to render as a refusal.
			unindexed: { changed: true },
			unindexNoop: { changed: false },
		},
	};
}

/** Stable JSON, so regeneration produces a byte-identical file. */
function stableStringify(value, indent = "\t", depth = 1) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	const pad = indent.repeat(depth);
	const close = indent.repeat(depth - 1);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const items = value.map((v) => pad + stableStringify(v, indent, depth + 1));
		return `[\n${items.join(",\n")}\n${close}]`;
	}
	const keys = Object.keys(value).sort();
	if (keys.length === 0) return "{}";
	const items = keys.map(
		(k) => `${pad}${JSON.stringify(k)}: ${stableStringify(value[k], indent, depth + 1)}`,
	);
	return `{\n${items.join(",\n")}\n${close}}`;
}

export async function renderFixtureFile() {
	const fixtures = await buildFixtures();
	return `/**
 * GENERATED FILE -- do not edit by hand.
 *
 * Produced by packages/core/test/generate-fixtures.js from the real builders
 * and the real IPC handler shapes. Regenerate with:
 *
 *     cd packages/core && pnpm build && node test/generate-fixtures.js
 *
 * The core suite fails if this file drifts from what the builders produce, so
 * renaming a field in the backend breaks the CORE tests, not just these.
 *
 * Every Context renderer test takes its input from here. Hand-written payloads
 * are what let three bugs ship green.
 */

export const PAYLOADS = ${stableStringify(fixtures)};
`;
}

// Written only when run directly, never as a side effect of importing.
if (process.argv[1] && process.argv[1].endsWith("generate-fixtures.js")) {
	const { writeFile, mkdir } = await import("node:fs/promises");
	const { dirname, join, resolve } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const here = dirname(fileURLToPath(import.meta.url));
	const out = resolve(here, "..", "..", "vscode", "test", "fixtures");
	await mkdir(out, { recursive: true });
	await writeFile(join(out, "payloads.js"), await renderFixtureFile(), "utf8");
	console.log(`wrote ${join(out, "payloads.js")}`);
}
