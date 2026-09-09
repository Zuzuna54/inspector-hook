/**
 * An optional prose narrative over the deterministic digest (P11).
 *
 * The digest states facts: files touched, tools run, prompts asked, replies
 * given. It never paraphrases, because `session-digest.ts` exists to guarantee
 * that a memory file says nothing untrue. This adds a paragraph that *does*
 * interpret — and it is additive, never a replacement. If it fails, is
 * disabled, or times out, the facts stand exactly as they were.
 *
 * ## Three gates, deliberately independent
 *
 * 1. `INSPECTOR_HOOK_NARRATIVE=1` — the operator opts the machine in.
 * 2. `claude` on PATH — the tool exists.
 * 3. `narrative: true` on the specific call — this session, chosen now.
 *
 * All three, every time. They are independent because each answers a different
 * question, and collapsing any two would make one of them unaskable: an
 * environment variable alone would run it for every session forever; a call
 * flag alone would run it on a machine whose operator never agreed to spend
 * model calls on it.
 *
 * **Never automatic on `session:ended`.** That is the one path where nobody is
 * watching, and a model call per session end is a cost that accrues silently.
 *
 * ## The child MUST have INSPECTOR_HOOK_DISABLED=1
 *
 * `claude -p` fires the installed hooks. Without this the core ingests its own
 * subprocess: the narrative call produces tool events, which become logs, which
 * become research items, which are then summarised by the next narrative call.
 * The corpus turns self-referential slowly and invisibly, and every count in
 * the panel starts including the tool's own reflection. All three shipped hooks
 * check this variable and exit 0 on it.
 *
 * ## The runner is injected
 *
 * So the tests exercise success, non-zero exit, timeout, empty output and a
 * missing binary without ever calling a model. A default runner that shells out
 * is supplied, but nothing in the test suite reaches it.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** What a runner returns. Shaped so a timeout is a state, not an exception. */
export interface RunResult {
	stdout: string;
	stderr: string;
	/** Process exit code, or null when it was killed. */
	code: number | null;
	timedOut: boolean;
}

export type NarrativeRunner = (
	prompt: string,
	options: { env: NodeJS.ProcessEnv; timeoutMs: number; cwd?: string },
) => Promise<RunResult>;

export interface NarrativeOptions {
	/** The per-call gate. Absent or false means no narrative, no questions. */
	narrative?: boolean;
	/** Process env, injected so tests do not mutate the real one. */
	env?: NodeJS.ProcessEnv;
	/** Injected for tests; defaults to shelling out to `claude -p`. */
	runner?: NarrativeRunner;
	/** Is the binary reachable? Injected so tests need no PATH. */
	hasClaude?: () => boolean;
	timeoutMs?: number;
	cwd?: string;
}

export interface NarrativeResult {
	/** The prose, when there is any. */
	text?: string;
	/**
	 * Why there is none.
	 *
	 * Always present when `text` is absent, and phrased for a human. A silent
	 * absence would be indistinguishable from a session that genuinely had
	 * nothing to say about it.
	 */
	reason?: string;
	/** Which gate stopped it, for a UI that wants to offer the fix. */
	gate?: "call" | "env" | "binary";
}

/** Long enough for a short summary, short enough not to stall a session end. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Ceiling on the prose kept. A narrative is a paragraph, not a document. */
export const MAX_NARRATIVE_CHARS = 1_200;

/** Ceiling on what is sent, so a long digest cannot become a long prompt. */
export const MAX_PROMPT_CHARS = 8_000;

/**
 * The environment a `claude -p` child runs in.
 *
 * Exported and tested on its own because the important part is a NEGATIVE
 * property — that the child cannot feed the corpus it is summarising — and a
 * negative property in a spawn call is exactly the kind that gets refactored
 * away by someone tidying up.
 */
export function childEnv(
	env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	return {
		...env,
		// `claude -p` fires the installed hooks. Without this the core ingests
		// its own subprocess and the corpus becomes self-referential.
		INSPECTOR_HOOK_DISABLED: "1",
	};
}

/** Is `claude` reachable? Cheap, and never throws. */
export function claudeOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
	const path = env.PATH ?? "";
	if (!path) return false;
	// Deliberately not `which`: that is a subprocess per check, and this runs
	// on a gate that is usually closed.
	for (const dir of path.split(":")) {
		if (dir && existsSync(join(dir, "claude"))) return true;
	}
	return false;
}

/** The default runner: `claude -p`, with the prompt on stdin. */
export const defaultRunner: NarrativeRunner = (prompt, options) =>
	new Promise<RunResult>((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const child = spawn("claude", ["-p"], {
			env: options.env,
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, options.timeoutMs);

		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({
				stdout,
				stderr: stderr || String(error),
				code: null,
				timedOut,
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code, timedOut });
		});

		child.stdin?.end(prompt);
	});

/**
 * The prompt.
 *
 * States plainly that the facts are already recorded and must not be repeated
 * or contradicted — the narrative sits BESIDE them in the same file, so a model
 * that restates them produces a memory file that says everything twice, and one
 * that contradicts them produces a file that argues with itself.
 */
export function narrativePrompt(digestBody: string): string {
	const facts = digestBody.slice(0, MAX_PROMPT_CHARS);
	return [
		"Below is a factual record of one coding session, already written.",
		"",
		"Write ONE short paragraph — at most four sentences — describing what the",
		"session was trying to achieve and whether it got there. Do not repeat the",
		"lists below; they are printed directly above your paragraph. Do not invent",
		"anything that is not supported by them. If the record does not show what",
		"was being attempted, say that plainly instead of guessing.",
		"",
		"Reply with the paragraph only: no preamble, no heading, no bullet points.",
		"",
		"---",
		facts,
	].join("\n");
}

/**
 * Produce a narrative, or say why not.
 *
 * Never throws and never rejects: every failure is a `reason`. The caller's
 * fallback is to print the facts alone, which is what it was going to do
 * anyway — so a narrative failure must not be able to cost a digest.
 */
export async function buildNarrative(
	digestBody: string,
	options: NarrativeOptions = {},
): Promise<NarrativeResult> {
	const env = options.env ?? process.env;

	// Gate 1: this call. Checked first because it is the cheapest and the most
	// specific — most callers never ask for a narrative at all.
	if (options.narrative !== true) {
		return { reason: "Not requested for this session.", gate: "call" };
	}

	// Gate 2: the machine.
	if (env.INSPECTOR_HOOK_NARRATIVE !== "1") {
		return {
			reason:
				"Narratives are off. Set INSPECTOR_HOOK_NARRATIVE=1 to enable them.",
			gate: "env",
		};
	}

	// Gate 3: the tool.
	const hasClaude = options.hasClaude ?? (() => claudeOnPath(env));
	if (!hasClaude()) {
		return { reason: "`claude` is not on PATH.", gate: "binary" };
	}

	const body = String(digestBody ?? "").trim();
	if (!body) {
		return { reason: "The digest has no body to narrate." };
	}

	const runner = options.runner ?? defaultRunner;
	let result: RunResult;
	try {
		result = await runner(narrativePrompt(body), {
			env: childEnv(env),
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			cwd: options.cwd,
		});
	} catch (error) {
		// A runner that throws is still just an absent narrative.
		return {
			reason: `The narrative runner failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	if (result.timedOut) {
		return {
			reason: `No narrative: \`claude -p\` did not answer within ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.`,
		};
	}
	if (result.code !== 0) {
		const detail = (result.stderr || "").trim().split("\n")[0];
		return {
			reason: `No narrative: \`claude -p\` exited ${result.code ?? "on a signal"}${detail ? ` — ${detail}` : ""}.`,
		};
	}

	const text = (result.stdout || "").trim();
	if (!text) {
		// A zero exit with no output is a real state and must not become an
		// empty section that looks like the model had nothing to say.
		return { reason: "No narrative: `claude -p` returned nothing." };
	}

	return { text: text.slice(0, MAX_NARRATIVE_CHARS) };
}

/**
 * Attach a narrative to a digest body.
 *
 * The facts come FIRST and are never modified. The prose is appended under its
 * own heading, labelled as generated, so a reader can tell at a glance which
 * half is recorded and which half is interpreted — the distinction the whole
 * digest module exists to protect.
 */
export function withNarrative(
	digestBody: string,
	narrative: NarrativeResult,
): string {
	if (!narrative.text) return digestBody;
	return [
		digestBody.replace(/\s+$/, ""),
		"",
		"## Summary (generated)",
		"",
		"_Written by `claude -p` from the record above. The facts above were_",
		"_recorded; this paragraph is an interpretation of them._",
		"",
		narrative.text,
		"",
	].join("\n");
}
