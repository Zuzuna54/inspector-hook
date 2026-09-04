/**
 * Resolve a working directory to the project it belongs to.
 *
 * ## Why this exists in the core rather than in the hook
 *
 * The hook used to derive `gitBranch`, `gitRemote` and `projectName` itself, by
 * shelling out to `git -C` and reading package.json. That was a large part of
 * the 337ms per-event cost, so M2's consolidation removed it — and removed the
 * fields with it, without noticing. Measured afterwards: 1610 of 4325 older
 * events carry git metadata and **0 of 1752 recent ones do**.
 *
 * The consequences were not cosmetic. `projectKey` is `gitRemote ?? cwd`, so
 * with the remote gone it fell back to whatever directory a tool happened to
 * run in, and one repository fragmented into five project keys in the live
 * index — 191 under the repo root, 67 under `packages/core`, 5 under
 * `packages/vscode`, and so on. Cross-project search and the per-project rollup
 * both key on that field.
 *
 * Doing it here costs the hook nothing: the core is a long-lived process, every
 * event already carries `cwd`, and the answer is the same for every event from
 * one directory. It is also cheaper than the original even on a cache miss,
 * because it reads `.git` directly instead of spawning `git` — walking up for
 * the repo root, then two small file reads.
 *
 * Resolving to the REPO ROOT rather than the event's own directory is what
 * de-fragments the key: every tool call inside a repository now reports the
 * same project regardless of which subdirectory it ran in.
 */

import { readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

export interface ProjectInfo {
	/** Absolute path of the repository root, or the directory itself. */
	root: string;
	/** Repository name from the remote, or the root directory's name. */
	projectName: string;
	/** Short remote name (`owner/repo`), when there is one. */
	gitRemote?: string;
	/** Current branch, when resolvable. */
	gitBranch?: string;
}

/**
 * Cache bound.
 *
 * A machine-wide core sees a handful of repositories, not thousands, but the
 * cache is keyed on every distinct `cwd` — and a repo with many subdirectories
 * produces many keys. Bounded so an unusual workload cannot grow it without
 * limit; this is the kind of map that becomes its own leak.
 */
const MAX_CACHE = 500;

const cache = new Map<string, ProjectInfo | null>();

/** Reset — for tests, and for a core that has been running across a checkout. */
export function clearProjectCache(): void {
	cache.clear();
}

/**
 * Walk up from `dir` looking for a `.git` entry.
 *
 * Stops at the filesystem root. Returns null when there is no repository, which
 * is a normal case — a session can run anywhere.
 */
function findRepoRoot(dir: string): string | null {
	let current = dir;
	const { root } = parse(current);
	// Bounded by the path depth; a symlink loop cannot make this infinite
	// because each step is a strict parent.
	for (let i = 0; i < 64; i++) {
		try {
			readFileSync(join(current, ".git", "HEAD"), "utf-8");
			return current;
		} catch {
			// Also handle a .git FILE (worktrees and submodules point elsewhere).
			try {
				const pointer = readFileSync(join(current, ".git"), "utf-8");
				if (pointer.startsWith("gitdir:")) return current;
			} catch {
				// Neither; keep walking.
			}
		}
		if (current === root) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

/** The current branch, from `.git/HEAD`. Detached HEAD yields undefined. */
function readBranch(repoRoot: string): string | undefined {
	try {
		const head = readFileSync(join(repoRoot, ".git", "HEAD"), "utf-8").trim();
		const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
		return match ? match[1] : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The origin remote, reduced to `owner/repo`.
 *
 * Parsed from `.git/config` rather than `git remote get-url`, so there is no
 * subprocess. Both SSH and HTTPS forms reduce to the same string, which matters
 * because the same repository cloned two ways must produce one project key.
 */
function readRemote(repoRoot: string): string | undefined {
	let config: string;
	try {
		config = readFileSync(join(repoRoot, ".git", "config"), "utf-8");
	} catch {
		return undefined;
	}

	const section = config.match(
		/\[remote\s+"origin"\][^[]*?url\s*=\s*(\S+)/,
	);
	if (!section) return undefined;

	const url = section[1];
	// git@host:owner/repo.git | https://host/owner/repo.git | ssh://…/owner/repo
	const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
	return m ? m[1] : url;
}

/**
 * Resolve a directory to its project, cached.
 *
 * Returns null when `dir` is not a usable path. Never throws: this runs on the
 * ingest path, and a resolution failure must degrade to "no metadata" rather
 * than dropping the event.
 */
export function resolveProject(dir: unknown): ProjectInfo | null {
	if (typeof dir !== "string" || dir.length === 0) return null;

	const cached = cache.get(dir);
	if (cached !== undefined) return cached;

	let info: ProjectInfo | null = null;
	try {
		const repoRoot = findRepoRoot(dir);
		if (repoRoot) {
			const gitRemote = readRemote(repoRoot);
			info = {
				root: repoRoot,
				// The remote's repo name is preferred: it is stable across clones
				// to differently-named directories.
				projectName: gitRemote?.split("/").pop() ?? basenameOf(repoRoot),
				gitRemote,
				gitBranch: readBranch(repoRoot),
			};
		} else {
			// Not a repository. Still worth a stable name so the project filter
			// has something to group on.
			info = { root: dir, projectName: basenameOf(dir) };
		}
	} catch {
		info = null;
	}

	if (cache.size >= MAX_CACHE) {
		// Oldest first; Map preserves insertion order.
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(dir, info);
	return info;
}

function basenameOf(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : path;
}
