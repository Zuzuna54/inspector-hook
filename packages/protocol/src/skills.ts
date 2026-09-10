/**
 * Skills and MCP tools: what is installed, and what actually fires (M8).
 *
 * ## Two distinctions the shape enforces
 *
 * **Installed versus built-in.** Seven distinct skills fired across the real
 * transcripts, but only THREE of them live in `~/.claude/skills` —
 * `artifact-design`, `run`, `artifact-capabilities` and `claude-api` ship with
 * Claude Code. Counting all seven against 22 installed would report 7/22 when
 * the true figure is 3/22, so `source` is not decoration.
 *
 * **Configured versus observed.** `claude-in-chrome` accounts for 548 of 684
 * measured MCP invocations and does not appear in `~/.claude.json` at all. A
 * Tools view driven by the config file alone would omit the single most-used
 * server on the machine, so observed tools are first-class and a server can
 * exist with `configured: false`.
 */

/** Where a skill came from. */
export type SkillSource =
	/** ~/.claude/skills — the user's own. */
	| "installed"
	/** <project>/.claude/skills — scoped to one repository. */
	| "project"
	/**
	 * From an enabled plugin's install directory.
	 *
	 * Measured: 3 official plugins are enabled and exactly ONE of them ships a
	 * skill (`frontend-design`). The plugin cache also holds 5 versions of that
	 * plugin, and a marketplace tree full of skills for plugins that were never
	 * installed — enumerating either would report skills that never load.
	 */
	| "plugin"
	/** Bundled with Claude Code. Not on disk anywhere we can enumerate. */
	| "builtin";

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	/** Observed on 11 of 22 real skills. */
	allowedTools?: string;
	/** Observed on 3, e.g. graphify's `/graphify`. */
	trigger?: string;
}

export interface SkillRecord {
	/** Directory name, which is what the Skill tool is invoked with. */
	id: string;
	source: SkillSource;
	/** Owning plugin, e.g. `frontend-design@claude-plugins-official`. */
	plugin?: string;
	/** Absolute path to the skill directory. Empty for a built-in. */
	path: string;
	/** Absolute path to SKILL.md, when one exists. */
	skillFile?: string;
	frontmatter: SkillFrontmatter;
	/**
	 * False when SKILL.md has no parseable frontmatter block.
	 *
	 * 8 of 22 real skills fail this. It is a defect, not an edge case: with no
	 * `description` the model has nothing to match against and can never choose
	 * the skill, so it is dead weight loaded into every session.
	 */
	frontmatterValid: boolean;
	/** Bytes of the whole directory tree. */
	bytes: number;
	/** Supporting directories — references/, assets/, and so on. */
	subdirectories: string[];
	/** Files beyond SKILL.md. Skills are trees, not single files. */
	extraFiles: number;
	/**
	 * Every supporting file, relative to the skill directory.
	 *
	 * The count alone was what shipped first, and it cannot answer the question
	 * a reader actually has: a skill reporting "3 supporting files ·
	 * references" never names `references/patterns.md`. Capped at
	 * MAX_TREE_FILES so one pathological skill cannot bloat the record;
	 * `extraFiles` remains the true total, so a truncated list is detectable.
	 */
	files: string[];
}

/** How often something was used, and where that was counted. */
export interface UsageStats {
	invocations: number;
	distinctSessions: number;
	distinctProjects: number;
	/** ISO timestamp of the most recent invocation. */
	lastUsed?: string;
}

export interface SkillWithUsage extends SkillRecord {
	usage: UsageStats;
}

export interface McpToolUsage extends UsageStats {
	/** Full tool name, e.g. `mcp__playwright__browser_navigate`. */
	tool: string;
	/** Server segment of the name. */
	server: string;
}

/**
 * Whether a configured server actually answers.
 *
 * `cannot-start` is the value that justified building this at all: on the
 * machine this was written for, `memory` is configured, has never been called,
 * and its interpreter no longer exists. From `~/.claude.json` alone that is
 * indistinguishable from a server you simply have not used yet.
 */
export type McpProbeStatus =
	/** Handshook and listed its tools. */
	| "reachable"
	/** The configured command could not be spawned at all. */
	| "cannot-start"
	/** Started, but did not finish the handshake in time. */
	| "timeout"
	/** Started, then exited or answered with an error. */
	| "failed"
	/** Not attempted: nothing configured to spawn. */
	| "not-configured";

export interface McpProbe {
	/** The key it is configured under. */
	server: string;
	status: McpProbeStatus;
	/** Milliseconds from spawn to the tool list. */
	durationMs: number;
	/**
	 * The name the server calls ITSELF.
	 *
	 * Worth reporting because it frequently disagrees with the config key: of
	 * the three reachable servers here, `fetcher` answers as `browser-mcp` and
	 * `mcp-ical` answers as `Calendar`.
	 */
	serverName?: string;
	serverVersion?: string;
	protocolVersion?: string;
	/**
	 * Tools the server ADVERTISES.
	 *
	 * Deliberately not merged with the observed counts. Playwright advertises
	 * 24 tools and 9 have ever been called here; "advertised but never used" is
	 * a finding, and merging the two lists would erase it.
	 */
	advertisedTools?: string[];
	/** Why it is not reachable. Safe to show verbatim. */
	error?: string;
	/** ISO timestamp, so a stale probe can be labelled as one. */
	checkedAt: string;
}

export interface McpServerRecord {
	name: string;
	/** Present in ~/.claude.json. False for a server seen only in transcripts. */
	configured: boolean;
	/** `stdio`, `sse`, … Only when configured. */
	type?: string;
	/** The command, WITHOUT env — that holds secrets and is never returned. */
	command?: string;
	args?: string[];
	tools: McpToolUsage[];
	usage: UsageStats;
}

/**
 * Where usage numbers came from.
 *
 * Transcripts are the complete record; our own logs are retention-pruned. A
 * count taken from logs alone undercounts, and the plan's original "1 of 22"
 * headline was exactly that mistake — transcripts show 3.
 */
export interface UsageSource {
	transcriptsScanned: number;
	/** Milliseconds spent reading them. */
	scanMs: number;
	/** Set when transcripts could not be read at all. */
	error?: string;
}

export interface SkillsOverview {
	skills: SkillWithUsage[];
	servers: McpServerRecord[];
	source: UsageSource;
	summary: {
		installed: number;
		/** Installed skills with at least one invocation. The headline. */
		installedUsed: number;
		/** Installed skills whose SKILL.md has no usable frontmatter. */
		invalid: number;
		/** Skills that fired but are not on disk — Claude Code's own. */
		builtinUsed: number;
		/** Skills contributed by enabled plugins. */
		pluginSkills: number;
		serversConfigured: number;
		serversObserved: number;
		mcpInvocations: number;
	};
}
