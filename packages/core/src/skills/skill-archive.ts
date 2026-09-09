/**
 * Archiving a skill (Milestone 8) — the one write path in the milestone.
 *
 * ## Why archive and not a toggle
 *
 * `~/.claude/settings.json` has no skills key. Measured on this machine: the
 * top-level keys are `agentPushNotifEnabled`, `alwaysThinkingEnabled`,
 * `autoMode`, `effortLevel`, `enabledPlugins`, `env`, `hooks`, `permissions`,
 * `skipAutoPermissionPrompt`, `statusLine`, `theme`, `tui` — and nothing for
 * skills. There is no supported switch to flip, so a Disable toggle would set
 * a key the platform never reads: the inert fix this branch keeps finding.
 *
 * Moving the directory is the only lever that demonstrably works, because
 * discovery is a directory listing. So the action is named after what it does:
 * the tree moves into our own store and can be moved back.
 *
 * ## Rules
 *
 * - Only a skill under the skills root can be archived. A plugin's skill
 *   belongs to the plugin (and would return on its next update); a built-in is
 *   not on disk at all.
 * - The destination must not already exist. Overwriting an earlier archive of
 *   the same name would destroy it.
 * - Restore refuses if something has since taken the original path — that
 *   something was not put there by us.
 * - Both directions record what happened, so the state is auditable rather
 *   than inferred from which directories exist.
 *
 * Nothing here runs during a scan. `buildSkillsOverview` never calls it, which
 * is what makes M8's "no file under ~/.claude is modified" acceptance a
 * property of the read path rather than a hope.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { SKILLS_ROOT } from "./skill-registry.js";

/** Subdirectory of the Inspector Hook store holding archived trees. */
export const ARCHIVE_DIR = join("skills", "archived");

/** The manifest recording every archive, so restores need no guesswork. */
export const ARCHIVE_MANIFEST = join("skills", "archived.json");

export interface ArchivedSkill {
	id: string;
	/** Where it came from, so Restore is exact rather than reconstructed. */
	originalPath: string;
	/** Where it is now. */
	archivedPath: string;
	archivedAt: string;
}

export interface ArchiveResult {
	ok: boolean;
	/** Present when ok is false. Safe to show verbatim. */
	error?: string;
	skill?: ArchivedSkill;
}

/** Refuse a path that escapes its base, whatever produced it. */
function contained(base: string, candidate: string): string {
	const root = resolve(base);
	const target = resolve(candidate);
	if (target !== root && !target.startsWith(`${root}/`)) {
		throw new Error(`Refusing a path outside ${root}: ${candidate}`);
	}
	return target;
}

/**
 * A skill id that is safe as one path segment.
 *
 * Skill ids come from a directory listing, so they cannot contain a separator
 * today. They arrive over IPC from the webview, though, which is where a
 * `../` would come from, so the check lives here rather than at the caller.
 */
function validId(id: string): boolean {
	return /^[A-Za-z0-9][\w.-]*$/.test(id) && id !== "." && id !== "..";
}

export interface ArchiveOptions {
	/** The Inspector Hook store root — `PersistenceStore.getBasePath()`. */
	storeRoot: string;
	/** Overridable for tests. Defaults to `~/.claude/skills`. */
	skillsRoot?: string;
}

async function readManifest(storeRoot: string): Promise<ArchivedSkill[]> {
	try {
		const text = await readFile(join(storeRoot, ARCHIVE_MANIFEST), "utf-8");
		const parsed = JSON.parse(text);
		return Array.isArray(parsed) ? (parsed as ArchivedSkill[]) : [];
	} catch {
		// No manifest yet, or one we cannot read. Either way there is nothing
		// recorded, and a restore will refuse rather than guess.
		return [];
	}
}

async function writeManifest(
	storeRoot: string,
	entries: ArchivedSkill[],
): Promise<void> {
	const path = join(storeRoot, ARCHIVE_MANIFEST);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf-8");
}

/** Everything currently archived. */
export async function listArchivedSkills(
	options: ArchiveOptions,
): Promise<ArchivedSkill[]> {
	const entries = await readManifest(options.storeRoot);
	// A tree deleted by hand should not be offered for restore.
	return entries.filter((e) => existsSync(e.archivedPath));
}

/**
 * Move a skill out of `~/.claude/skills` and into our store.
 *
 * `rename` first, because it is atomic and both paths are normally on the same
 * volume. A cross-device move falls back to copy-then-remove, and the remove
 * only happens once the copy has succeeded — so an interrupted archive leaves
 * the skill installed rather than gone.
 */
export async function archiveSkill(
	id: string,
	options: ArchiveOptions,
): Promise<ArchiveResult> {
	if (!validId(id)) return { ok: false, error: `not a valid skill id: ${id}` };

	const skillsRoot = options.skillsRoot ?? SKILLS_ROOT;
	const source = contained(skillsRoot, join(skillsRoot, id));
	if (!existsSync(source)) {
		return { ok: false, error: `no installed skill named ${id}` };
	}

	const archiveRoot = join(options.storeRoot, ARCHIVE_DIR);
	const target = contained(archiveRoot, join(archiveRoot, id));
	if (existsSync(target)) {
		return {
			ok: false,
			error: `${id} is already archived; restore or remove that copy first`,
		};
	}

	await mkdir(archiveRoot, { recursive: true });
	try {
		await rename(source, target);
	} catch {
		await cp(source, target, { recursive: true });
		await rm(source, { recursive: true, force: true });
	}

	const entry: ArchivedSkill = {
		id,
		originalPath: source,
		archivedPath: target,
		archivedAt: new Date().toISOString(),
	};
	const entries = (await readManifest(options.storeRoot)).filter(
		(e) => e.id !== id,
	);
	entries.push(entry);
	await writeManifest(options.storeRoot, entries);

	return { ok: true, skill: entry };
}

/**
 * Put an archived skill back where it came from.
 *
 * The original path comes from the manifest, not from `skillsRoot` plus the
 * id: a project-scoped skill archived from elsewhere must go back to
 * elsewhere, and reconstructing the path would quietly install it globally.
 */
export async function restoreSkill(
	id: string,
	options: ArchiveOptions,
): Promise<ArchiveResult> {
	if (!validId(id)) return { ok: false, error: `not a valid skill id: ${id}` };

	const entries = await readManifest(options.storeRoot);
	const entry = entries.find((e) => e.id === id);
	if (!entry) return { ok: false, error: `${id} is not archived` };
	if (!existsSync(entry.archivedPath)) {
		return { ok: false, error: `the archived copy of ${id} is gone` };
	}
	if (existsSync(entry.originalPath)) {
		// Someone reinstalled it, or authored a new skill under the same name.
		// Either way it is not ours to overwrite.
		return {
			ok: false,
			error: `${entry.originalPath} already exists; not overwriting it`,
		};
	}

	await mkdir(dirname(entry.originalPath), { recursive: true });
	try {
		await rename(entry.archivedPath, entry.originalPath);
	} catch {
		await cp(entry.archivedPath, entry.originalPath, { recursive: true });
		await rm(entry.archivedPath, { recursive: true, force: true });
	}

	await writeManifest(
		options.storeRoot,
		entries.filter((e) => e.id !== id),
	);
	return { ok: true, skill: entry };
}
