/**
 * The projects Inspector Hook can scan (Milestone 7).
 *
 * M7 scans every project the tool observes, not the tool's own repository, so
 * the first question is what that set actually is. Measured 2026-09-09:
 *
 *     31  project directories Claude Code has transcripts for
 *     17  still exist on disk
 *      3  have a package.json          -> knip applies
 *      8  have .git
 *      1  had a graphify graph
 *
 * Fourteen are gone. A registry that reported 31 scannable projects would send
 * every scan through fourteen failures, so existence is checked and the missing
 * ones are reported as missing rather than dropped — "this project moved" is
 * information, and silently shrinking the list hides it.
 *
 * ## Why transcripts are the source
 *
 * Three places know about projects and only one is complete. The research
 * index knows 4 project keys, because it is dominated by work on this
 * repository. The sessions store holds 8 files, bounded by retention. The
 * transcript directory under `~/.claude/projects/` is Claude Code's own record
 * and outlives both — the same reasoning that made M8's utilisation counts read
 * transcripts instead of our pruned logs.
 *
 * ## Why the path is read from inside the transcript
 *
 * The directory name is the project path with separators replaced by dashes,
 * which is **not reversible**: `-Users-gio-Desktop-dev-inspector-hook` could be
 * `/Users/gio/Desktop/dev/inspector-hook` or `/Users/gio/Desktop/dev-inspector/hook`.
 * Every transcript entry carries an exact `cwd`, so that is read instead and
 * the dashed name is only a fallback.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where Claude Code keeps per-project transcripts. */
export const TRANSCRIPT_ROOT = join(homedir(), ".claude", "projects");

/** Bytes of a transcript read while looking for a `cwd`. */
export const CWD_PROBE_BYTES = 64 * 1024;

/** Which analyses can run against a project, and why. */
export interface ProjectTools {
	/** knip needs a package.json; it traces JS/TS module graphs. */
	knip: boolean;
	/** madge needs TypeScript or JavaScript sources to walk. */
	madge: boolean;
	/** graphify takes anything — code, docs, images. Always applicable. */
	graphify: boolean;
	/** `sonar analyze secrets` is language-agnostic and needs no connection. */
	sonarSecrets: boolean;
}

export interface ScannableProject {
	/** Absolute path, read from the transcript's own `cwd` where possible. */
	root: string;
	/** Directory name, for display. */
	name: string;
	/** The transcript directory this was discovered through. */
	transcriptDir: string;
	exists: boolean;
	hasGit: boolean;
	hasPackageJson: boolean;
	hasTsconfig: boolean;
	/** True when `graphify-out/graph.json` is already present. */
	hasGraph: boolean;
	tools: ProjectTools;
	/** How the root was determined, because one way is a guess. */
	rootSource: "transcript" | "dashed-name";
}

export interface RegistrySummary {
	discovered: number;
	existing: number;
	missing: number;
	withGraph: number;
	knipEligible: number;
}

/**
 * Recover a path from a transcript directory name.
 *
 * Lossy and known to be: dashes in a real directory name are indistinguishable
 * from separators. Used only when no `cwd` could be read, and the result is
 * marked `dashed-name` so a caller can distrust it.
 */
export function pathFromDashedName(dir: string): string {
	return `/${dir.replace(/^-+/, "").split("-").join("/")}`;
}

/** The exact `cwd` a transcript records, or null. */
export function cwdFromTranscript(dir: string): string | null {
	let entries: string[];
	try {
		entries = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
	} catch {
		return null;
	}
	// Newest first: an old transcript may name a path that has since moved.
	entries.sort();
	for (const file of entries.reverse()) {
		const full = join(dir, file);
		let head: string;
		try {
			const size = statSync(full).size;
			const buffer = Buffer.alloc(Math.min(size, CWD_PROBE_BYTES));
			const fd = readFileSync(full);
			fd.copy(buffer, 0, 0, buffer.length);
			head = buffer.toString("utf-8");
		} catch {
			continue;
		}
		for (const line of head.split("\n")) {
			if (!line.includes('"cwd"')) continue;
			try {
				const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
				if (typeof cwd === "string" && cwd.startsWith("/")) return cwd;
			} catch {
				// A truncated last line is expected when only the head was read.
			}
		}
	}
	return null;
}

function toolsFor(p: {
	exists: boolean;
	hasPackageJson: boolean;
	hasTsconfig: boolean;
}): ProjectTools {
	return {
		// Without a package.json knip has no entry points to trace and reports
		// the whole tree as unused, which is worse than not running.
		knip: p.exists && p.hasPackageJson,
		madge: p.exists && (p.hasTsconfig || p.hasPackageJson),
		graphify: p.exists,
		sonarSecrets: p.exists,
	};
}

/**
 * Every project Inspector Hook could scan.
 *
 * Missing projects are RETURNED with `exists: false` rather than filtered out.
 * A scan needs to know the difference between "clean" and "gone", and so does
 * anyone reading a list that shrank from 31 to 17.
 */
export function discoverProjects(options?: {
	transcriptRoot?: string;
}): ScannableProject[] {
	const root = options?.transcriptRoot ?? TRANSCRIPT_ROOT;
	let dirs: string[];
	try {
		dirs = readdirSync(root, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return [];
	}

	const out: ScannableProject[] = [];
	const seen = new Set<string>();

	for (const dir of dirs.sort()) {
		const full = join(root, dir);
		const fromTranscript = cwdFromTranscript(full);
		const path = fromTranscript ?? pathFromDashedName(dir);

		// Two transcript directories can name one path (a repo opened at
		// different times). One entry per path, or every scan runs twice.
		if (seen.has(path)) continue;
		seen.add(path);

		const exists = existsSync(path);
		const hasPackageJson = exists && existsSync(join(path, "package.json"));
		const hasTsconfig = exists && existsSync(join(path, "tsconfig.json"));
		const project: ScannableProject = {
			root: path,
			name: path.split("/").filter(Boolean).pop() ?? path,
			transcriptDir: dir,
			exists,
			hasGit: exists && existsSync(join(path, ".git")),
			hasPackageJson,
			hasTsconfig,
			hasGraph: exists && existsSync(join(path, "graphify-out", "graph.json")),
			tools: toolsFor({ exists, hasPackageJson, hasTsconfig }),
			rootSource: fromTranscript ? "transcript" : "dashed-name",
		};
		out.push(project);
	}

	return out;
}

export function summarise(projects: ScannableProject[]): RegistrySummary {
	return {
		discovered: projects.length,
		existing: projects.filter((p) => p.exists).length,
		missing: projects.filter((p) => !p.exists).length,
		withGraph: projects.filter((p) => p.hasGraph).length,
		knipEligible: projects.filter((p) => p.tools.knip).length,
	};
}
