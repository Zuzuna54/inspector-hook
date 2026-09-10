/**
 * Which agent, or which session, spawned an agent (M5.9).
 *
 * ## Why this was `not-impl`, and what changed
 *
 * M5 promised "a live agent tree" and shipped a flat list, because **no
 * captured hook event states parentage** — `agentId` says which agent did a
 * thing, never who asked for it. Inventing a hierarchy from timing would have
 * been a guess, so `children` stayed empty and the row stayed honest.
 *
 * M8's transcript work turned up the missing signal in a place M5 never looked:
 * **the on-disk layout already encodes it.** A subagent's transcript lives at
 *
 *     <project>/<parent session>.jsonl
 *     <project>/<parent session>/subagents/agent-<id>.jsonl
 *
 * so the directory a transcript sits in names its parent. That is not
 * inference — the platform wrote the path.
 *
 * ## Depth is measured, not assumed
 *
 * The nesting generalises: an agent that spawned an agent would appear at
 * `…/subagents/agent-<parent>/subagents/agent-<child>.jsonl`, and the walk
 * below handles any depth. Measured across all 83 subagent transcripts on this
 * machine: **0 at the second level, and 0 `Task`/`Agent` tool calls inside any
 * subagent transcript.** So every real tree here is exactly one level deep —
 * and that is a finding, not a limitation of this code. `maxDepth` in the
 * result reports what was actually found, so "flat" is never mistaken for
 * "unimplemented" again.
 *
 * ## Coverage is partial and says so
 *
 * 27 of the 221 agents in the store have a transcript: the rest predate the
 * `subagents/` layout or belong to sessions whose transcripts are gone.
 * An agent with no transcript keeps `parentAgentId` undefined rather than
 * being attached to a guessed parent.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { TRANSCRIPT_ROOT } from "../quality/project-registry.js";

/** The directory a subagent's transcript sits in, under its parent. */
const SUBAGENT_DIR = "subagents";

/** Filename prefix on a subagent transcript. */
const AGENT_PREFIX = "agent-";

/** How deep the walk goes before giving up on a pathological tree. */
const MAX_NESTING = 6;

export interface AgentParent {
	/** The agent id, matching the `agentId` carried on tool events. */
	agentId: string;
	/** The top-level session this agent ultimately belongs to. */
	sessionId: string;
	/** The agent that spawned it, when the nesting is deeper than one level. */
	parentAgentId?: string;
	/** Project directory name, as Claude Code dashes it. */
	project: string;
	/** Absolute path to this agent's own transcript. */
	transcriptPath: string;
	/** 1 for an agent spawned by a session, 2 for one spawned by an agent. */
	depth: number;
}

export interface ParentageResult {
	/** agentId → where it came from. */
	parents: Map<string, AgentParent>;
	/** The deepest nesting actually found. 1 means no agent spawned an agent. */
	maxDepth: number;
	/** Transcript directories walked. */
	sessionsScanned: number;
	/** Set when the transcript root could not be read at all. */
	error?: string;
}

/**
 * Read parentage out of the transcript tree.
 *
 * Walks directories only — it never opens a transcript, because the answer is
 * in the path. That keeps this cheap enough to run on core startup beside the
 * agent backfill.
 */
export async function discoverAgentParents(
	transcriptRoot = TRANSCRIPT_ROOT,
): Promise<ParentageResult> {
	const parents = new Map<string, AgentParent>();
	let maxDepth = 0;
	let sessionsScanned = 0;

	let projects: string[];
	try {
		projects = await readdir(transcriptRoot);
	} catch (error) {
		return {
			parents,
			maxDepth: 0,
			sessionsScanned: 0,
			error: `could not read ${transcriptRoot}: ${(error as Error).message}`,
		};
	}

	/**
	 * Descend one `subagents/` directory.
	 *
	 * `owner` is the agent that owns this directory, or undefined at the top
	 * level where the owner is the session itself.
	 */
	const walk = async (
		dir: string,
		project: string,
		sessionId: string,
		owner: string | undefined,
		depth: number,
	): Promise<void> => {
		if (depth > MAX_NESTING) return;
		let entries: string[];
		try {
			entries = await readdir(join(dir, SUBAGENT_DIR));
		} catch {
			// Most sessions spawn no agents; that is not an error.
			return;
		}

		for (const entry of entries) {
			if (!entry.endsWith(".jsonl")) continue;
			const agentId = basename(entry, ".jsonl").replace(AGENT_PREFIX, "");
			const transcriptPath = join(dir, SUBAGENT_DIR, entry);
			parents.set(agentId, {
				agentId,
				sessionId,
				...(owner ? { parentAgentId: owner } : {}),
				project,
				transcriptPath,
				depth,
			});
			if (depth > maxDepth) maxDepth = depth;

			// An agent that spawned agents has its own subagents/ directory
			// beside its transcript. None exists on this machine; the walk is
			// here so the answer stays measured rather than assumed.
			await walk(
				join(dir, SUBAGENT_DIR, basename(entry, ".jsonl")),
				project,
				sessionId,
				agentId,
				depth + 1,
			);
		}
	};

	for (const project of projects) {
		const projectDir = join(transcriptRoot, project);
		let entries: string[];
		try {
			if (!(await stat(projectDir)).isDirectory()) continue;
			entries = await readdir(projectDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			// A session directory, named for the session, holding subagents/.
			if (entry.endsWith(".jsonl")) continue;
			const sessionDir = join(projectDir, entry);
			try {
				if (!(await stat(sessionDir)).isDirectory()) continue;
			} catch {
				continue;
			}
			sessionsScanned++;
			await walk(sessionDir, project, entry, undefined, 1);
		}
	}

	return { parents, maxDepth, sessionsScanned };
}
