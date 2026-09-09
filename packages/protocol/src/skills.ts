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
