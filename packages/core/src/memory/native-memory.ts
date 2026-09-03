/**
 * Claude Code's native auto memory, as a readable and writable store.
 *
 * Milestone 3 deliberately does NOT invent a parallel memory system. Claude
 * Code already owns the storage location, the file format and the loading
 * mechanism: `~/.claude/projects/<slug>/memory/MEMORY.md` is read every session
 * as an index, and the per-topic files it links are loaded on demand. Anything
 * written in that format and location is picked up with no injection hook at
 * all — strictly less machinery than intercepting SessionStart, and it survives
 * compaction because the platform re-reads it.
 *
 * What this module adds is what the platform does not do: read the corpus back,
 * across every project on the machine, and let it be curated.
 *
 * ## The format, verified against the corpus rather than assumed
 *
 * Surveyed on this machine: 18 project directories contain a `memory/`
 * directory, 9 of those have a MEMORY.md, and there are 31 memory files
 * totalling ~83KB. 30 of the 31 carry YAML frontmatter with `name`,
 * `description` and `metadata.type`; one predates it and has none. So the
 * documented format is real, and a reader that requires frontmatter would
 * still silently drop a file that a human wrote. Reading is therefore
 * tolerant; writing always emits the full documented format.
 *
 * ## Why writes are conservative
 *
 * These files are the user's, they live outside the workspace, and they change
 * what future Claude sessions are told. Three rules follow, and they are
 * enforced here rather than left to callers:
 *
 * 1. A file Inspector Hook did not create is never overwritten. Authored files
 *    carry `metadata.source: inspector-hook`; a write to a path lacking it is
 *    refused.
 * 2. MEMORY.md is never rewritten wholesale — only a single index line is
 *    appended or replaced in place. This project has already shipped one
 *    destructive whole-key rewrite (`install.sh` doing `jq '.hooks = $hooks'`,
 *    which would have deleted a co-installed tool's hooks); the same mistake
 *    against a hand-curated index would destroy notes no tool can regenerate.
 * 3. Nothing is written unless the caller supplies the memory directory, and
 *    the only supported way to obtain it is from a transcript path that Claude
 *    Code itself provided. Guessing a directory means writing memory that is
 *    never read, which is worse than not writing it.
 */

import { readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** The type vocabulary native auto memory uses. */
export type MemoryType = "user" | "feedback" | "project" | "reference";

const MEMORY_TYPES: readonly MemoryType[] = [
	"user",
	"feedback",
	"project",
	"reference",
];

/** Marks a file this tool authored, and may therefore modify. */
export const AUTHORED_BY = "inspector-hook";

/** The index file every project's memory directory uses. */
export const INDEX_FILE = "MEMORY.md";

/**
 * How much of the index Claude Code loads every session.
 *
 * Used only to report when an index has grown past the point where its tail
 * stops being read; nothing here truncates a user's file.
 */
export const INDEX_LOAD_LINES = 200;
export const INDEX_LOAD_BYTES = 25 * 1024;

/** One parsed memory file. */
export interface MemoryFile {
	/** Absolute path on disk. */
	path: string;
	/** File name including extension. */
	fileName: string;
	/** The `name:` slug, falling back to the file stem when absent. */
	name: string;
	/** The `description:` line, if the file has one. */
	description?: string;
	/** `metadata.type`, when it is one of the four known values. */
	type?: MemoryType;
	/** `metadata.source`, present on files this tool wrote. */
	source?: string;
	/** Body text with frontmatter removed. */
	body: string;
	/** Whether the file actually had frontmatter, as opposed to defaults. */
	hasFrontmatter: boolean;
	/** Size in bytes. */
	size: number;
	/** Last modification time, ISO 8601. */
	modified: string;
	/** True when no MEMORY.md line references this file. */
	orphaned: boolean;
}

/** A project's memory directory, summarised. */
export interface MemoryProject {
	/** The `~/.claude/projects/<slug>` directory name. */
	slug: string;
	/** Absolute path to the `memory/` directory. */
	memoryDir: string;
	/** The workspace path this slug most likely refers to, when resolvable. */
	workspacePath?: string;
	/** Files in the directory, excluding the index. */
	files: MemoryFile[];
	/** Whether MEMORY.md exists. Without it, nothing here is loaded by name. */
	hasIndex: boolean;
	/** Total bytes of all memory files, excluding the index. */
	totalSize: number;
	/** Index size, so a caller can warn before the load limit bites. */
	indexLines: number;
	indexBytes: number;
}

/**
 * Locate a session's memory directory from the transcript path Claude Code
 * supplied on the hook payload.
 *
 * Returns null when there is no usable path. That is the correct answer rather
 * than a computed guess: the project slug replaces both `/` and `_` with `-`,
 * so `/a/b_c` and `/a/b-c` produce the same slug, and a wrong directory means
 * writing memory that is never loaded.
 */
export function resolveMemoryDir(transcriptPath: unknown): string | null {
	if (typeof transcriptPath !== "string" || transcriptPath.length === 0) {
		return null;
	}
	const projectDir = dirname(transcriptPath);
	// A bare filename yields "." from dirname, which is not a project directory.
	if (projectDir === "." || projectDir === "/" || projectDir === "") return null;
	return join(projectDir, "memory");
}

/** The root under which Claude Code keeps per-project state. */
export function projectsRoot(home: string = homedir()): string {
	return join(home, ".claude", "projects");
}

/**
 * Parse a memory file's frontmatter and body.
 *
 * Tolerant on purpose. The parser handles only the shape these files actually
 * use — a flat block of `key: value` with a single nested `metadata:` map — and
 * is not a general YAML parser; a file it cannot read still yields its body, so
 * content is never lost to a parse failure.
 */
export function parseMemoryFile(
	text: string,
	fileName = "",
): {
	name?: string;
	description?: string;
	type?: MemoryType;
	source?: string;
	body: string;
	hasFrontmatter: boolean;
} {
	const stem = fileName.replace(/\.md$/i, "");

	if (!text.startsWith("---\n")) {
		// The pre-frontmatter form. One such file exists in the surveyed corpus,
		// and a human wrote it, so it is read rather than skipped.
		return { name: stem || undefined, body: text, hasFrontmatter: false };
	}

	const end = text.indexOf("\n---", 4);
	if (end === -1) {
		// An unterminated block is not frontmatter; treat the whole file as body.
		return { name: stem || undefined, body: text, hasFrontmatter: false };
	}

	const head = text.slice(4, end);
	const body = text.slice(end + 4).replace(/^\n+/, "");

	let name: string | undefined;
	let description: string | undefined;
	let type: MemoryType | undefined;
	let source: string | undefined;
	let inMetadata = false;

	for (const rawLine of head.split("\n")) {
		if (!rawLine.trim()) continue;
		const indented = /^\s+/.test(rawLine);
		const line = rawLine.trim();

		if (!indented) inMetadata = line === "metadata:";

		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = stripQuotes(line.slice(colon + 1).trim());
		if (!value) continue;

		if (!indented) {
			if (key === "name") name = value;
			else if (key === "description") description = value;
		} else if (inMetadata) {
			if (key === "type" && isMemoryType(value)) type = value;
			else if (key === "source") source = value;
		}
	}

	return {
		name: name || stem || undefined,
		description,
		type,
		source,
		body,
		hasFrontmatter: true,
	};
}

function stripQuotes(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		if ((first === '"' || first === "'") && value.endsWith(first)) {
			return value.slice(1, -1);
		}
	}
	return value;
}

function isMemoryType(value: string): value is MemoryType {
	return (MEMORY_TYPES as readonly string[]).includes(value);
}

/**
 * Render a memory file in the documented format.
 *
 * Always emits full frontmatter, including `metadata.source`, which is what
 * later authorises this tool to modify the file again.
 */
export function formatMemoryFile(entry: {
	name: string;
	description: string;
	type: MemoryType;
	body: string;
	source?: string;
}): string {
	const body = entry.body.trimEnd();
	return [
		"---",
		`name: ${escapeScalar(entry.name)}`,
		`description: ${escapeScalar(entry.description)}`,
		"metadata:",
		`  type: ${entry.type}`,
		`  source: ${entry.source ?? AUTHORED_BY}`,
		"---",
		"",
		body,
		"",
	].join("\n");
}

/**
 * Quote a frontmatter scalar when it would otherwise be misread.
 *
 * A description containing a colon-space is the realistic case: unquoted, the
 * remainder of the line parses as a nested key and the description is truncated
 * at the colon.
 */
function escapeScalar(value: string): string {
	const flat = value.replace(/[\r\n]+/g, " ").trim();
	if (/^[\s>|&*!%@`[{"']/.test(flat) || /:\s/.test(flat) || flat.endsWith(":")) {
		return `"${flat.replace(/(["\\])/g, "\\$1")}"`;
	}
	return flat;
}

/** A file name for a memory entry: kebab-case, `.md`, no path separators. */
export function memoryFileName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return `${slug || "untitled"}.md`;
}

/**
 * Read the index and return the file names it references.
 *
 * Covers both forms in use: markdown links `[Title](file.md)` and wiki links
 * `[[name]]`. A file referenced by neither is never loaded by name, which is
 * what `orphaned` reports.
 */
export function parseIndexReferences(indexText: string): Set<string> {
	const refs = new Set<string>();
	for (const m of indexText.matchAll(/\(([^)\s]+\.md)\)/g)) {
		refs.add(basename(m[1]));
	}
	for (const m of indexText.matchAll(/\[\[([^\]]+)\]\]/g)) {
		const ref = m[1].trim();
		refs.add(ref.endsWith(".md") ? basename(ref) : `${ref}.md`);
	}
	return refs;
}

/**
 * List one project's memory directory.
 *
 * A missing or unreadable directory yields an empty listing rather than
 * throwing: 9 of the 18 surveyed directories are empty, which is normal.
 */
export async function readMemoryProject(
	memoryDir: string,
	options?: { workspacePath?: string },
): Promise<MemoryProject> {
	const slug = basename(dirname(memoryDir));
	const empty: MemoryProject = {
		slug,
		memoryDir,
		workspacePath: options?.workspacePath,
		files: [],
		hasIndex: false,
		totalSize: 0,
		indexLines: 0,
		indexBytes: 0,
	};

	let names: string[];
	try {
		names = await readdir(memoryDir);
	} catch {
		return empty;
	}

	let indexText = "";
	let hasIndex = false;
	if (names.includes(INDEX_FILE)) {
		try {
			indexText = await readFile(join(memoryDir, INDEX_FILE), "utf-8");
			hasIndex = true;
		} catch {
			hasIndex = false;
		}
	}
	const referenced = parseIndexReferences(indexText);

	const files: MemoryFile[] = [];
	for (const fileName of names.sort()) {
		if (fileName === INDEX_FILE) continue;
		if (!fileName.toLowerCase().endsWith(".md")) continue;
		const full = join(memoryDir, fileName);
		try {
			const info = await stat(full);
			if (!info.isFile()) continue;
			const text = await readFile(full, "utf-8");
			const parsed = parseMemoryFile(text, fileName);
			files.push({
				path: full,
				fileName,
				name: parsed.name ?? fileName.replace(/\.md$/i, ""),
				description: parsed.description,
				type: parsed.type,
				source: parsed.source,
				body: parsed.body,
				hasFrontmatter: parsed.hasFrontmatter,
				size: info.size,
				modified: info.mtime.toISOString(),
				orphaned: hasIndex ? !referenced.has(fileName) : true,
			});
		} catch {
			// Unreadable entry; skip it rather than failing the whole listing.
		}
	}

	return {
		slug,
		memoryDir,
		workspacePath: options?.workspacePath,
		files,
		hasIndex,
		totalSize: files.reduce((sum, f) => sum + f.size, 0),
		indexLines: indexText ? indexText.split("\n").length : 0,
		indexBytes: Buffer.byteLength(indexText, "utf-8"),
	};
}

/**
 * Every project on the machine that has a memory directory.
 *
 * This is the cross-project rollup native memory structurally cannot do: it is
 * scoped to one project at a time, so "where did I solve this before" has no
 * answer from inside a session. Inspector Hook sees the whole machine through
 * one core, so it does.
 */
export async function listMemoryProjects(
	options?: { home?: string; includeEmpty?: boolean },
): Promise<MemoryProject[]> {
	const root = projectsRoot(options?.home);
	let slugs: string[];
	try {
		slugs = await readdir(root);
	} catch {
		return [];
	}

	const projects: MemoryProject[] = [];
	for (const slug of slugs.sort()) {
		const memoryDir = join(root, slug, "memory");
		try {
			const info = await stat(memoryDir);
			if (!info.isDirectory()) continue;
		} catch {
			continue;
		}
		const project = await readMemoryProject(memoryDir);
		if (project.files.length === 0 && !project.hasIndex && !options?.includeEmpty) {
			continue;
		}
		projects.push(project);
	}
	return projects;
}

/** Why a write was refused. */
export type WriteRefusal =
	| "no-memory-dir"
	| "not-authored-by-us"
	| "unreadable";

export interface WriteResult {
	written: boolean;
	path?: string;
	indexUpdated?: boolean;
	refused?: WriteRefusal;
	reason?: string;
}

/**
 * Create or update one memory file, and reference it from the index.
 *
 * Refuses to overwrite a file that does not carry `metadata.source:
 * inspector-hook`, so a hand-written note can never be replaced by a generated
 * one. The write itself is temp-file-plus-rename, matching the persistence
 * store, so a crash mid-write cannot leave a half-written memory that a later
 * session would read as fact.
 */
export async function writeMemoryFile(
	memoryDir: string | null,
	entry: {
		name: string;
		description: string;
		type: MemoryType;
		body: string;
		title?: string;
	},
): Promise<WriteResult> {
	if (!memoryDir) {
		return {
			written: false,
			refused: "no-memory-dir",
			reason:
				"No memory directory: the session has no transcript path, and the " +
				"project slug cannot be computed safely because it is lossy.",
		};
	}

	const fileName = memoryFileName(entry.name);
	const target = join(memoryDir, fileName);

	// Guard an existing file we did not author.
	try {
		const existing = await readFile(target, "utf-8");
		const parsed = parseMemoryFile(existing, fileName);
		if (parsed.source !== AUTHORED_BY) {
			return {
				written: false,
				path: target,
				refused: "not-authored-by-us",
				reason:
					`${fileName} exists and was not written by Inspector Hook ` +
					"(no metadata.source), so it is left untouched.",
			};
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code && code !== "ENOENT") {
			return {
				written: false,
				path: target,
				refused: "unreadable",
				reason: `Cannot read ${fileName}: ${code}`,
			};
		}
	}

	const text = formatMemoryFile(entry);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, text, "utf-8");
	await rename(temp, target);

	const indexUpdated = await upsertIndexEntry(memoryDir, {
		fileName,
		title: entry.title ?? entry.name,
		description: entry.description,
	});

	return { written: true, path: target, indexUpdated };
}

/**
 * Add or refresh one line in MEMORY.md, leaving every other line alone.
 *
 * The index is hand-curated — the surveyed corpus includes one with prose
 * sections a human added — so this only ever touches the single line that
 * references `fileName`. It never reorders, reformats or removes anything else.
 */
export async function upsertIndexEntry(
	memoryDir: string,
	entry: { fileName: string; title: string; description?: string },
): Promise<boolean> {
	const indexPath = join(memoryDir, INDEX_FILE);
	const line = entry.description
		? `- [${entry.title}](${entry.fileName}) — ${entry.description}`
		: `- [${entry.title}](${entry.fileName})`;

	let text = "";
	try {
		text = await readFile(indexPath, "utf-8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code && code !== "ENOENT") return false;
		// A memory directory with no index yet: 9 of 18 surveyed are in this
		// state. Files there are never loaded by name, so creating the index is
		// what makes them reachable at all.
		text = "# Memory\n\n";
	}

	const lines = text.split("\n");
	const ref = `(${entry.fileName})`;
	const existing = lines.findIndex((l) => l.startsWith("- [") && l.includes(ref));

	if (existing !== -1) {
		if (lines[existing] === line) return false; // already correct
		lines[existing] = line;
	} else {
		while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		lines.push(line, "");
	}

	const next = lines.join("\n");
	const temp = `${indexPath}.${process.pid}.tmp`;
	await writeFile(temp, next.endsWith("\n") ? next : `${next}\n`, "utf-8");
	await rename(temp, indexPath);
	return true;
}

/**
 * Reference an existing file from the index, without touching the file.
 *
 * This exists because `writeMemoryFile` refuses a file it did not author, and
 * that refusal — correct for content — made the most useful curation action
 * impossible for exactly the files that need it. An orphaned hand-written note
 * is never loaded by name, and fixing that requires only an index line; there
 * is no reason to rewrite, or be blocked from rewriting, its body.
 *
 * The file must already exist. Indexing a missing file would leave MEMORY.md
 * pointing at nothing, which is worse than the orphan: an orphan is merely
 * unloaded, whereas a dangling reference misreports what memory contains.
 *
 * Title and description default to the file's own frontmatter, so a caller does
 * not have to restate what the file already says about itself.
 */
export async function indexMemoryFile(
	memoryDir: string,
	fileName: string,
	overrides?: { title?: string; description?: string },
): Promise<{ indexed: boolean; changed?: boolean; reason?: string }> {
	const safeName = basename(fileName);
	if (safeName === INDEX_FILE) {
		return { indexed: false, reason: "The index cannot reference itself." };
	}

	let text: string;
	try {
		text = await readFile(join(memoryDir, safeName), "utf-8");
	} catch {
		return {
			indexed: false,
			reason: `${safeName} does not exist; indexing it would leave a dangling reference.`,
		};
	}

	const parsed = parseMemoryFile(text, safeName);
	const changed = await upsertIndexEntry(memoryDir, {
		fileName: safeName,
		title: overrides?.title ?? parsed.name ?? safeName.replace(/\.md$/i, ""),
		description: overrides?.description ?? parsed.description,
	});
	return { indexed: true, changed };
}

/**
 * Delete a memory file and drop its index line.
 *
 * `force` is required to remove a file this tool did not author, so curation
 * from the UI can still delete a hand-written note when the user asks — but
 * never as a side effect of an automated pass.
 */
export async function deleteMemoryFile(
	memoryDir: string,
	fileName: string,
	options?: { force?: boolean },
): Promise<{ deleted: boolean; reason?: string }> {
	const safeName = basename(fileName);
	if (safeName === INDEX_FILE) {
		return { deleted: false, reason: "The index is not deletable." };
	}
	const target = join(memoryDir, safeName);

	let text: string;
	try {
		text = await readFile(target, "utf-8");
	} catch {
		return { deleted: false, reason: `${safeName} does not exist.` };
	}

	if (!options?.force) {
		const parsed = parseMemoryFile(text, safeName);
		if (parsed.source !== AUTHORED_BY) {
			return {
				deleted: false,
				reason: `${safeName} was not written by Inspector Hook; pass force to delete it.`,
			};
		}
	}

	await unlink(target);
	await removeIndexEntry(memoryDir, safeName);
	return { deleted: true };
}

/** Remove the one index line referencing a file. */
export async function removeIndexEntry(
	memoryDir: string,
	fileName: string,
): Promise<boolean> {
	const indexPath = join(memoryDir, INDEX_FILE);
	let text: string;
	try {
		text = await readFile(indexPath, "utf-8");
	} catch {
		return false;
	}
	const ref = `(${fileName})`;
	const lines = text.split("\n");
	const kept = lines.filter((l) => !(l.startsWith("- [") && l.includes(ref)));
	if (kept.length === lines.length) return false;

	const next = kept.join("\n");
	const temp = `${indexPath}.${process.pid}.tmp`;
	await writeFile(temp, next.endsWith("\n") ? next : `${next}\n`, "utf-8");
	await rename(temp, indexPath);
	return true;
}
