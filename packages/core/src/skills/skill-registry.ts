/**
 * Discovering installed skills (Milestone 8).
 *
 * Skills are write-only today: you author one, it loads into every session's
 * context, and nothing tells you whether it has ever been chosen. Measured on
 * this machine — **22 installed, 3 ever used, and 8 with no usable
 * frontmatter at all.**
 *
 * ## A skill is a directory tree, not a file
 *
 * Real examples carry `references/`, `assets/`, `assets/scaffold/`, and
 * graphify's has a `.graphify_version`. Anything that reports size, or later
 * copies or removes a skill, has to handle the tree — which is why `bytes` is
 * the whole directory and `extraFiles` is counted separately.
 *
 * ## Frontmatter fields, counted rather than assumed
 *
 * Across the real 22: `name` 14, `description` 14, `allowed-tools` 11,
 * `trigger` 3. So eight have none, and that is the finding: with no
 * `description` the model has nothing to match against and can never choose
 * the skill. It still costs context in every session.
 *
 * `frontmatterValid` requires a `name` specifically. A block containing only
 * `allowed-tools` parses as YAML and is still unusable.
 *
 * ## This module reads. It never writes.
 *
 * M8 is inventory and measurement only. Nothing here touches `~/.claude`, so
 * the milestone's acceptance test is a directory diff. The one write path in
 * the milestone lives in `skill-archive.ts` and runs only when asked.
 */

import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
	SkillFrontmatter,
	SkillRecord,
	SkillSource,
} from "@inspector-hook/protocol";

/** Where the user's own skills live. */
export const SKILLS_ROOT = join(homedir(), ".claude", "skills");

/** Project-scoped skills, relative to a repository root. */
export const PROJECT_SKILLS_DIR = join(".claude", "skills");

/** Cap on a SKILL.md read, so a pathological file cannot stall a scan. */
export const MAX_SKILL_BYTES = 2 * 1024 * 1024;

/** Depth walked when sizing a skill's tree. */
const MAX_TREE_DEPTH = 4;

/**
 * Parse a SKILL.md frontmatter block.
 *
 * Hand-rolled for the same reason `native-memory.ts` hand-rolls its own: the
 * subset in use is `key: value` with optional quotes, and a YAML dependency to
 * read four keys would be the first runtime dependency of a package whose
 * point is not to need one.
 *
 * Returns `valid: false` when there is no block, when it is unterminated, or
 * when it carries no `name` — all three leave the model with nothing to match.
 */
export function parseSkillFrontmatter(text: string): {
	frontmatter: SkillFrontmatter;
	valid: boolean;
} {
	const frontmatter: SkillFrontmatter = {};
	if (!text.startsWith("---")) return { frontmatter, valid: false };

	const end = text.indexOf("\n---", 3);
	if (end === -1) return { frontmatter, valid: false };

	for (const line of text.slice(3, end).split("\n")) {
		const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		if (!match) continue;
		const key = match[1];
		// Quotes are optional in the real files and appear on descriptions
		// containing colons.
		const value = match[2].trim().replace(/^["']|["']$/g, "");
		if (!value) continue;
		switch (key) {
			case "name":
				frontmatter.name = value;
				break;
			case "description":
				frontmatter.description = value;
				break;
			case "allowed-tools":
				frontmatter.allowedTools = value;
				break;
			case "trigger":
				frontmatter.trigger = value;
				break;
			default:
				// Unknown keys are ignored rather than rejected: the platform may
				// add fields, and a skill is not invalid for using one.
				break;
		}
	}

	return { frontmatter, valid: Boolean(frontmatter.name) };
}

/** Total bytes, subdirectories and extra files in a skill's tree. */
function measureTree(root: string): {
	bytes: number;
	subdirectories: string[];
	extraFiles: number;
} {
	let bytes = 0;
	let extraFiles = 0;
	const subdirectories: string[] = [];

	const walk = (dir: string, depth: number, prefix: string): void => {
		if (depth > MAX_TREE_DEPTH) return;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				subdirectories.push(rel);
				walk(full, depth + 1, rel);
				continue;
			}
			try {
				bytes += statSync(full).size;
			} catch {
				// A file that vanished mid-walk contributes nothing.
			}
			if (rel !== "SKILL.md") extraFiles++;
		}
	};
	walk(root, 0, "");

	return { bytes, subdirectories, extraFiles };
}

/** Read one skill directory. */
function readSkill(dir: string, id: string, source: SkillSource): SkillRecord {
	const skillFile = join(dir, "SKILL.md");
	const hasFile = existsSync(skillFile);

	let frontmatter: SkillFrontmatter = {};
	let valid = false;
	if (hasFile) {
		try {
			const size = statSync(skillFile).size;
			const text = readFileSync(skillFile, "utf-8").slice(
				0,
				Math.min(size, MAX_SKILL_BYTES),
			);
			const parsed = parseSkillFrontmatter(text);
			frontmatter = parsed.frontmatter;
			valid = parsed.valid;
		} catch {
			// Unreadable is as unusable as absent, and reported the same way.
		}
	}

	const tree = measureTree(dir);
	return {
		id,
		source,
		path: dir,
		skillFile: hasFile ? skillFile : undefined,
		frontmatter,
		frontmatterValid: valid,
		bytes: tree.bytes,
		subdirectories: tree.subdirectories,
		extraFiles: tree.extraFiles,
	};
}

/** Skill directories under one root. */
function readRoot(root: string, source: SkillSource): SkillRecord[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const out: SkillRecord[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const name = entry.name;
		if (name.startsWith(".")) continue;
		out.push(readSkill(join(root, name), name, source));
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Where the enabled-plugin list lives. */
export const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

/** Where plugin install paths are recorded. */
export const INSTALLED_PLUGINS_PATH = join(
	homedir(),
	".claude",
	"plugins",
	"installed_plugins.json",
);

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/**
 * Skills contributed by ENABLED plugins.
 *
 * Resolved through `installed_plugins.json` → `installPath`, intersected with
 * `settings.json` → `enabledPlugins`. Both filters are load-bearing, measured
 * on this machine:
 *
 * - the cache holds **5 versions** of `frontend-design`, three of them carrying
 *   `.orphaned_at`. Walking the cache reports the same skill five times.
 * - `plugins/marketplaces/` holds SKILL.md files for telegram, discord,
 *   imessage and claude-md-management — plugins that were never installed.
 *   Walking the marketplace reports skills that can never fire.
 * - two of the three enabled plugins (`typescript-lsp`, `pyright-lsp`) ship no
 *   skills at all, so the plan's "3 official plugins enabled" is 3 plugins and
 *   **one** skill.
 *
 * `installPath` is therefore the only source used: it names one directory per
 * installation, and the platform wrote it.
 */
export function discoverPluginSkills(options?: {
	settingsPath?: string;
	installedPluginsPath?: string;
}): SkillRecord[] {
	const settings = readJson(options?.settingsPath ?? SETTINGS_PATH);
	const enabled = new Set<string>();
	const raw = settings?.enabledPlugins;
	if (raw && typeof raw === "object") {
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			// The value is a boolean, and `false` means installed-but-off.
			if (value === true) enabled.add(key);
		}
	}
	if (enabled.size === 0) return [];

	const installed = readJson(
		options?.installedPluginsPath ?? INSTALLED_PLUGINS_PATH,
	);
	const plugins = installed?.plugins;
	if (!plugins || typeof plugins !== "object") return [];

	const out: SkillRecord[] = [];
	const seen = new Set<string>();

	for (const [key, entries] of Object.entries(
		plugins as Record<string, unknown>,
	)) {
		if (!enabled.has(key) || !Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!entry || typeof entry !== "object") continue;
			const installPath = (entry as Record<string, unknown>).installPath;
			if (typeof installPath !== "string") continue;
			for (const skill of readRoot(join(installPath, "skills"), "plugin")) {
				// One plugin can be installed at both user and project scope,
				// pointing at the same install path. The same skill must not be
				// counted twice.
				const dedupe = `${key}::${skill.id}`;
				if (seen.has(dedupe)) continue;
				seen.add(dedupe);
				out.push({ ...skill, plugin: key });
			}
		}
	}

	return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every skill Inspector Hook can see.
 *
 * Built-in skills are NOT enumerated: they live inside the Claude Code
 * installation, their location is not a documented contract, and guessing at it
 * would produce a list that breaks on the next release. They are still
 * *recognised* when one fires — see `skills-overview.ts`, which marks an
 * invoked skill that matches no discovered directory as `builtin`. Recognising
 * a name is safe; inventing a filesystem layout is not.
 */
export function discoverSkills(options?: {
	skillsRoot?: string;
	projectRoots?: string[];
	settingsPath?: string;
	installedPluginsPath?: string;
	/** Skip plugin discovery. Set by tests that pin the installed set. */
	includePlugins?: boolean;
}): SkillRecord[] {
	const out = readRoot(options?.skillsRoot ?? SKILLS_ROOT, "installed");

	for (const project of options?.projectRoots ?? []) {
		const dir = join(project, PROJECT_SKILLS_DIR);
		if (!existsSync(dir)) continue;
		out.push(...readRoot(dir, "project"));
	}

	if (options?.includePlugins !== false) {
		out.push(
			...discoverPluginSkills({
				settingsPath: options?.settingsPath,
				installedPluginsPath: options?.installedPluginsPath,
			}),
		);
	}

	return out;
}
