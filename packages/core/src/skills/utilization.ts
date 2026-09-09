/**
 * How often a skill or an MCP tool actually fires (Milestone 8).
 *
 * ## Why this reads transcripts and not our own logs
 *
 * M4's retention is live and pruning: `~/.inspector-hook/logs/` reaches back
 * days, while the transcripts under `~/.claude/projects` are the complete
 * record. The plan's headline — "22 skills installed, 1 has ever fired" — came
 * from the pruned side and was wrong. Counted over the transcripts: **13
 * invocations across 7 distinct skills**, of which 3 are installed. So the
 * honest headline is 3 of 22, and the difference is entirely the data source.
 *
 * ## Installed versus built-in
 *
 * Four of those 7 (`artifact-design`, `artifact-capabilities`, `run`,
 * `claude-api`) are not in `~/.claude/skills` — they ship with Claude Code.
 * Crediting them to the installed set would report 7 of 22. A name that fires
 * and matches no discovered directory is therefore reported with
 * `source: "builtin"` rather than dropped: it is real usage, just not the
 * user's own skill.
 *
 * ## Configured versus observed, for MCP
 *
 * `claude-in-chrome` is 548 of the 684 measured MCP invocations and appears
 * nowhere in `~/.claude.json`. A Tools view driven by the config file would
 * omit the busiest server on the machine, so observed servers are listed with
 * `configured: false` beside the configured ones.
 *
 * Nothing here writes. The whole milestone is inventory and measurement.
 */

import { readFileSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type {
	McpServerRecord,
	McpToolUsage,
	UsageSource,
	UsageStats,
} from "@inspector-hook/protocol";

import { TRANSCRIPT_ROOT } from "../quality/project-registry.js";
import { readTranscript } from "../transcript/transcript-reader.js";

/** Subagent transcripts live one level below their session. */
const SUBAGENT_DIR = "subagents";

/** Where MCP servers are configured. */
export const CLAUDE_CONFIG = join(homedir(), ".claude.json");

/**
 * Namespaced tool names, e.g. `mcp__claude-in-chrome__navigate`.
 *
 * The server segment is lazy rather than `[^_]+` because real server names
 * contain single underscores — `mcp__claude_ai_Google_Drive__search_files` is
 * in this corpus — and a match up to the first `__` is what actually splits
 * them. A greedy `[^_]+` would report that server as `claude` and merge
 * unrelated servers together.
 */
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

/** One thing that fired, with the sets needed to derive distinct counts. */
interface Tally {
	invocations: number;
	sessions: Set<string>;
	projects: Set<string>;
	lastUsed?: string;
}

function tally(): Tally {
	return { invocations: 0, sessions: new Set(), projects: new Set() };
}

function record(t: Tally, session: string, project: string, at?: string): void {
	t.invocations++;
	t.sessions.add(session);
	t.projects.add(project);
	// Transcripts are appended in order, but a scan visits files in directory
	// order, so `lastUsed` has to be a max rather than a last-write.
	if (at && (!t.lastUsed || at > t.lastUsed)) t.lastUsed = at;
}

function stats(t: Tally): UsageStats {
	return {
		invocations: t.invocations,
		distinctSessions: t.sessions.size,
		distinctProjects: t.projects.size,
		...(t.lastUsed ? { lastUsed: t.lastUsed } : {}),
	};
}

/** An empty tally, for something installed that has never fired. */
export function noUsage(): UsageStats {
	return { invocations: 0, distinctSessions: 0, distinctProjects: 0 };
}

/**
 * Pull the skill name out of a `Skill` tool call.
 *
 * The reader hands over `JSON.stringify(input)`, and the field is `skill`.
 * A regex on the raw text would be cheaper, but the input also carries `args`
 * — free text, and 3 of the 13 real invocations have one — so a text match
 * would read a skill name out of a sentence. None currently does; parsing is
 * what keeps that from being a matter of luck.
 */
export function skillFromToolInput(text: string): string | undefined {
	try {
		const input = JSON.parse(text) as Record<string, unknown>;
		const name = input.skill;
		return typeof name === "string" && name.length > 0 ? name : undefined;
	} catch {
		return undefined;
	}
}

/** Split a namespaced MCP tool name into server and tool. */
export function splitMcpTool(
	name: string,
): { server: string; tool: string } | undefined {
	const match = MCP_TOOL.exec(name);
	if (!match) return undefined;
	return { server: match[1], tool: match[2] };
}

export interface UtilizationResult {
	/** Skill name → usage. Keyed on the name as invoked. */
	skills: Map<string, UsageStats>;
	/** Full tool name → usage, for `mcp__*` calls only. */
	mcpTools: Map<string, McpToolUsage>;
	source: UsageSource;
}

export interface ScanOptions {
	transcriptRoot?: string;
	/**
	 * Project directory names to include. Omitted means all of them.
	 *
	 * Open Risk 9: counting across every project reads 31 projects' work, so
	 * the allowlist is part of the API rather than a later addition.
	 */
	projects?: string[];
}

/** One transcript file, with the project and session it belongs to. */
export interface TranscriptRef {
	project: string;
	/** The top-level session, even for a subagent's own transcript. */
	session: string;
	path: string;
	/** True for `<session>/subagents/agent-*.jsonl`. */
	subagent: boolean;
}

/**
 * Every transcript under the root, main sessions and subagents alike.
 *
 * **Subagent transcripts are the majority of the corpus and are nested.** The
 * layout is `<project>/<session>.jsonl` for a session and
 * `<project>/<session>/subagents/agent-*.jsonl` for each subagent it spawned.
 * Measured: 38 top-level files and **83 subagent files** — a flat readdir sees
 * 31% of the corpus, and one sampled session alone hid 130 tool calls in 2
 * subagent files against 45 in its own transcript. Missing them is exactly the
 * undercount that made the plan's "1 of 22" wrong, one level down.
 *
 * A subagent's calls are attributed to its PARENT session, because that is the
 * unit `distinctSessions` is meant to count — a session that spawned six
 * agents is one session, not seven. Verified not to double-count: the parent
 * transcript carries no `tool_use` id that also appears in a subagent file
 * (0 overlap on the sampled session), so the two sets are disjoint.
 */
export async function findTranscripts(
	root: string,
	allow?: string[],
): Promise<TranscriptRef[]> {
	const wanted = allow ? new Set(allow) : undefined;
	let projects: string[];
	try {
		projects = await readdir(root);
	} catch {
		return [];
	}

	const out: TranscriptRef[] = [];
	for (const project of projects) {
		if (wanted && !wanted.has(project)) continue;
		const dir = join(root, project);
		let entries: Dirent[];
		try {
			if (!(await stat(dir)).isDirectory()) continue;
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			// A project directory that vanished mid-scan contributes nothing.
			continue;
		}

		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				out.push({
					project,
					session: basename(entry.name, ".jsonl"),
					path: join(dir, entry.name),
					subagent: false,
				});
				continue;
			}
			if (!entry.isDirectory()) continue;
			// A session directory. Its name is the session id, and the subagent
			// transcripts sit one level below it.
			const subagents = join(dir, entry.name, SUBAGENT_DIR);
			let files: string[];
			try {
				files = await readdir(subagents);
			} catch {
				// Most session directories hold no subagents; that is not an error.
				continue;
			}
			for (const file of files) {
				if (!file.endsWith(".jsonl")) continue;
				out.push({
					project,
					session: entry.name,
					path: join(subagents, file),
					subagent: true,
				});
			}
		}
	}
	return out;
}

/**
 * Count skill and MCP invocations across the transcript corpus.
 *
 * Streams with `limit: 0`, so nothing is retained per file and a 48 MB
 * transcript costs the same memory as a 4 KB one.
 */
export async function scanUtilization(
	options: ScanOptions = {},
): Promise<UtilizationResult> {
	const root = options.transcriptRoot ?? TRANSCRIPT_ROOT;
	const started = Date.now();

	const skills = new Map<string, Tally>();
	const mcp = new Map<string, { server: string; tool: string; t: Tally }>();

	const files = await findTranscripts(root, options.projects);
	let scanned = 0;
	let failed = 0;

	for (const { project, path, session } of files) {
		try {
			await readTranscript(path, {
				limit: 0,
				visit: (entry) => {
					if (entry.kind !== "tool_use" || !entry.toolName) return;
					if (entry.toolName === "Skill") {
						const name = skillFromToolInput(entry.text);
						if (!name) return;
						let t = skills.get(name);
						if (!t) {
							t = tally();
							skills.set(name, t);
						}
						record(t, session, project, entry.timestamp);
						return;
					}
					const split = splitMcpTool(entry.toolName);
					if (!split) return;
					let slot = mcp.get(entry.toolName);
					if (!slot) {
						slot = { server: split.server, tool: split.tool, t: tally() };
						mcp.set(entry.toolName, slot);
					}
					record(slot.t, session, project, entry.timestamp);
				},
			});
			scanned++;
		} catch {
			// One unreadable transcript must not void the whole count; the total
			// scanned is reported so a caller can see the shortfall.
			failed++;
		}
	}

	const source: UsageSource = {
		transcriptsScanned: scanned,
		scanMs: Date.now() - started,
	};
	if (scanned === 0) {
		source.error =
			files.length === 0
				? `no transcripts under ${root}`
				: `all ${files.length} transcripts failed to read`;
	} else if (failed > 0) {
		source.error = `${failed} of ${files.length} transcripts could not be read`;
	}

	return {
		skills: new Map([...skills].map(([k, v]) => [k, stats(v)])),
		mcpTools: new Map(
			[...mcp].map(([name, slot]) => [
				name,
				{ tool: name, server: slot.server, ...stats(slot.t) },
			]),
		),
		source,
	};
}

/** A configured MCP server, without its env. */
export interface ConfiguredServer {
	type?: string;
	command?: string;
	args?: string[];
}

/**
 * MCP servers from `~/.claude.json`, global and per-project.
 *
 * `env` is dropped here rather than at the view: it holds API keys, and a
 * value that never enters the record cannot leak through a later feature that
 * forgets to filter it.
 */
export function readConfiguredServers(
	configPath = CLAUDE_CONFIG,
): Map<string, ConfiguredServer> {
	const out = new Map<string, ConfiguredServer>();
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
			string,
			unknown
		>;
	} catch {
		return out;
	}

	const collect = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
			if (!raw || typeof raw !== "object" || out.has(name)) continue;
			const entry = raw as Record<string, unknown>;
			out.set(name, {
				...(typeof entry.type === "string" ? { type: entry.type } : {}),
				...(typeof entry.command === "string"
					? { command: entry.command }
					: {}),
				...(Array.isArray(entry.args)
					? { args: entry.args.filter((a): a is string => typeof a === "string") }
					: {}),
			});
		}
	};

	collect(parsed.mcpServers);
	// Per-project servers count as configured too. None exist on this machine
	// (0 of 33 projects), but the key is documented and reading it costs one
	// loop rather than a later bug report.
	const projects = parsed.projects;
	if (projects && typeof projects === "object") {
		for (const cfg of Object.values(projects as Record<string, unknown>)) {
			if (cfg && typeof cfg === "object") {
				collect((cfg as Record<string, unknown>).mcpServers);
			}
		}
	}

	return out;
}

/**
 * Merge configured servers with observed tool calls.
 *
 * Both directions matter and neither is a subset of the other: a configured
 * server that never fired is the same finding as an unused skill, and an
 * observed server that is not configured means the config file is not the
 * inventory it looks like.
 */
export function mergeServers(
	configured: Map<string, ConfiguredServer>,
	tools: Map<string, McpToolUsage>,
): McpServerRecord[] {
	const byServer = new Map<string, McpToolUsage[]>();
	for (const usage of tools.values()) {
		const list = byServer.get(usage.server);
		if (list) list.push(usage);
		else byServer.set(usage.server, [usage]);
	}

	const names = new Set([...configured.keys(), ...byServer.keys()]);
	const out: McpServerRecord[] = [];

	for (const name of [...names].sort()) {
		const config = configured.get(name);
		const serverTools = (byServer.get(name) ?? []).sort(
			(a, b) => b.invocations - a.invocations,
		);

		let invocations = 0;
		let lastUsed: string | undefined;
		for (const tool of serverTools) {
			invocations += tool.invocations;
			if (tool.lastUsed && (!lastUsed || tool.lastUsed > lastUsed)) {
				lastUsed = tool.lastUsed;
			}
		}
		// Distinct sessions and projects cannot be summed across tools without
		// double-counting, and the per-tool sets are gone by now. The server
		// figure is therefore the maximum any one of its tools saw — a lower
		// bound, which is the only honest reduction available here.
		const sessions = Math.max(0, ...serverTools.map((t) => t.distinctSessions));
		const projects = Math.max(0, ...serverTools.map((t) => t.distinctProjects));

		out.push({
			name,
			configured: Boolean(config),
			...(config?.type ? { type: config.type } : {}),
			...(config?.command ? { command: config.command } : {}),
			...(config?.args ? { args: config.args } : {}),
			tools: serverTools,
			usage: {
				invocations,
				distinctSessions: sessions,
				distinctProjects: projects,
				...(lastUsed ? { lastUsed } : {}),
			},
		});
	}

	return out;
}
