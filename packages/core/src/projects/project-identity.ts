/**
 * One project, across three identity spaces.
 *
 * This module exists because the same project is called three different things
 * depending on which part of the store you ask, and every one of them is the
 * canonical name somewhere:
 *
 * | space         | keyed on                    | measured example                                        |
 * |---------------|-----------------------------|---------------------------------------------------------|
 * | sessions      | `metadata.workingDirectory` | `/Users/g/Desktop/inspector_hook/inspector-hook/packages/core` |
 * | memory        | the directory slug          | `-Users-giorgobg-Desktop-inspector-hook-inspector-hook`  |
 * | research      | the git remote              | `Zuzuna54/inspector-hook`                                |
 *
 * Those three strings share no substring in common and all name one project.
 *
 * ## Why matching is three-valued
 *
 * `in` / `out` / **`unknown`**. A boolean forces "cannot tell" to become "no",
 * and "no" HIDES DATA -- which is not a hypothetical: measured on this store,
 * 0 of 17 memory files and 0 of 238 file changes carried any project key at
 * all, so a boolean filter hid almost the whole corpus and reported it as an
 * empty result set.
 *
 * Unknown is therefore a first-class answer. Callers include unknowns and
 * label them, rather than silently dropping or silently claiming them.
 *
 * ## Slug derivation goes ONE WAY, and only one way
 *
 * A path maps to a slug deterministically: `/` and `_` both become `-`. The
 * reverse does not exist. `-Users-giorgobg-Desktop-inspector-hook-inspector-hook`
 * could be `.../inspector_hook/inspector-hook`, `.../inspector-hook/inspector-hook`,
 * or `.../inspector/hook/inspector/hook`, and on this machine the naive
 * reverse produced a non-existent directory for 2 of 3 slugs tested.
 *
 * So slugs are computed FROM known paths and compared, never parsed back into
 * one. A memory project whose slug matches no known path stays its own
 * identity rather than being attached to a guess -- `native-memory.ts` already
 * refuses that guess for exactly this reason, because a wrong directory means
 * writing memory that is never loaded.
 */

import { resolveProject } from "../managers/project-resolver.js";

export type ProjectMatch = "in" | "out" | "unknown";

/** Where a project identity was seen, so the picker can show its weight. */
export interface ProjectCounts {
	sessions: number;
	memory: number;
	research: number;
	changes: number;
}

export interface ProjectIdentity {
	/**
	 * Stable handle the UI passes back.
	 *
	 * The repository root when one is known, because that is the only key that
	 * survives a clone to a different directory name AND a project with no git
	 * remote. Memory-only projects fall back to `slug:<slug>`, which is the
	 * only thing known about them.
	 */
	id: string;
	/** Display name. */
	name: string;
	/** Repository root, when a path for this project has been seen. */
	root?: string;
	/** What the research index keys on. */
	gitRemote?: string;
	/** What native memory keys on. */
	slug?: string;
	/**
	 * Every concrete path observed for this project, deduplicated.
	 *
	 * Carried so a client can decide membership by EXACT set lookup instead of
	 * re-deriving it. The core's matcher resolves a path to its repository root
	 * through the filesystem; a webview cannot, and a prefix rule is the wrong
	 * substitute -- it is what let a home-directory session absorb every
	 * project beneath it. Shipping the resolved paths keeps one matcher's
	 * answers, rather than two matchers that drift.
	 */
	paths: string[];
	counts: ProjectCounts;
}

/**
 * Anything that might belong to a project.
 *
 * Every field optional, because most records carry only one of them and some
 * carry none -- which is the `unknown` case this whole module is shaped
 * around.
 */
export interface ProjectCandidate {
	/** A filesystem path: a session's cwd, a changed file, a workspace root. */
	path?: string;
	/** A research or context `projectKey`: a git remote, a root, or a cwd. */
	projectKey?: string;
	/** A native-memory directory slug. */
	slug?: string;
}

/** `/` and `_` both become `-`. See the header: this direction only. */
export function slugForPath(path: string): string {
	return String(path).replace(/[/_]/g, "-");
}

/**
 * Every key a candidate offers, normalised.
 *
 * A path is resolved to its repository root first. Without that, one repo
 * fragments into one project per subdirectory a tool happened to run in --
 * measured here as 3 session directories for 2 real projects, one of them
 * `.../inspector-hook/packages/core`.
 */
function keysOf(candidate: ProjectCandidate): {
	paths: string[];
	keys: string[];
	slugs: string[];
} {
	const paths: string[] = [];
	const keys: string[] = [];
	const slugs: string[] = [];

	if (candidate.path) {
		paths.push(candidate.path);
		const resolved = resolveProject(candidate.path);
		if (resolved?.root) paths.push(resolved.root);
		if (resolved?.gitRemote) keys.push(resolved.gitRemote);
	}
	if (candidate.projectKey) {
		keys.push(candidate.projectKey);
		// A projectKey is a remote OR a path, and which one is not declared.
		// Treated as both rather than guessed at.
		if (candidate.projectKey.startsWith("/")) paths.push(candidate.projectKey);
	}
	if (candidate.slug) slugs.push(candidate.slug);

	return { paths, keys, slugs };
}

/**
 * Does this record belong to this project?
 *
 * Returns `unknown` when the candidate offers nothing to decide on -- never
 * `out`. The caller shows unknowns in a labelled group; turning them into
 * `out` here is the one change that would make this filter hide data.
 */
export function matches(
	identity: ProjectIdentity,
	candidate: ProjectCandidate,
): ProjectMatch {
	const { paths, keys, slugs } = keysOf(candidate);
	if (paths.length === 0 && keys.length === 0 && slugs.length === 0) {
		return "unknown";
	}

	// Exact equality on RESOLVED roots. `resolveProject` already walks a
	// subdirectory up to its repository root, so containment adds nothing --
	// and containment actively breaks things: a session run from the home
	// directory resolves to `/Users/<me>`, which contains every project on the
	// machine, so a parent-child rule let one session swallow all of them.
	// Measured: it collapsed the whole repo into a `giorgobg` project.
	if (identity.root && paths.includes(identity.root)) return "in";
	if (identity.gitRemote && keys.includes(identity.gitRemote)) return "in";
	if (identity.root && keys.includes(identity.root)) return "in";
	if (identity.slug && slugs.includes(identity.slug)) return "in";

	// A path-derived slug, so a memory record still matches a project known
	// only by its path. One direction only -- see the header.
	if (identity.root && slugs.includes(slugForPath(identity.root))) return "in";

	return "out";
}

/** A candidate plus where it was counted, for building the registry. */
export interface ProjectObservation {
	candidate: ProjectCandidate;
	source: keyof ProjectCounts;
	/** Preferred display name, when the source knows one. */
	name?: string;
}

function emptyCounts(): ProjectCounts {
	return { sessions: 0, memory: 0, research: 0, changes: 0 };
}

/**
 * Fold observations into one identity per project.
 *
 * Two observations merge when they share ANY key, which is what lets a session
 * (a path), a memory directory (a slug) and a research item (a remote) collapse
 * into the single project they describe. Merging is repeated until nothing
 * changes, because a session can be the only thing that knows a path and a
 * remote belong together -- so the memory slug only joins once that link
 * exists, which may be after it was first seen.
 */
export function buildProjects(
	observations: ProjectObservation[],
): ProjectIdentity[] {
	const groups: {
		roots: Set<string>;
		remotes: Set<string>;
		slugs: Set<string>;
		/** Raw observed paths, before resolution to a repository root. */
		observed: Set<string>;
		names: string[];
		counts: ProjectCounts;
	}[] = [];

	const shares = (
		group: (typeof groups)[number],
		k: ReturnType<typeof keysOf>,
	): boolean => {
		// Exact roots only. See `matches`: a containment rule here let a session
		// run from the home directory merge every project beneath it into one.
		for (const path of k.paths) {
			if (group.roots.has(path)) return true;
		}
		for (const key of k.keys) {
			if (group.remotes.has(key) || group.roots.has(key)) return true;
		}
		for (const slug of k.slugs) {
			if (group.slugs.has(slug)) return true;
			for (const root of group.roots) {
				if (slugForPath(root) === slug) return true;
			}
		}
		return false;
	};

	for (const observation of observations) {
		const k = keysOf(observation.candidate);
		if (k.paths.length === 0 && k.keys.length === 0 && k.slugs.length === 0) {
			continue;
		}

		let group = groups.find((g) => shares(g, k));
		if (!group) {
			group = {
				roots: new Set(),
				remotes: new Set(),
				slugs: new Set(),
				observed: new Set(),
				names: [],
				counts: emptyCounts(),
			};
			groups.push(group);
		}

		// The repository root, not the raw path: otherwise one repo becomes as
		// many projects as it has subdirectories.
		for (const path of k.paths) {
			group.observed.add(path);
			const resolved = resolveProject(path);
			group.roots.add(resolved?.root ?? path);
			if (resolved?.gitRemote) group.remotes.add(resolved.gitRemote);
			if (resolved?.projectName) group.names.push(resolved.projectName);
		}
		for (const key of k.keys) {
			if (!key.startsWith("/")) group.remotes.add(key);
		}
		for (const slug of k.slugs) group.slugs.add(slug);
		if (observation.name) group.names.push(observation.name);
		group.counts[observation.source]++;
	}

	// One more pass: a group created before the link existed can now share keys
	// with another. Repeated to a fixed point rather than once, because each
	// merge can expose a further one.
	let merged = true;
	while (merged) {
		merged = false;
		outer: for (let i = 0; i < groups.length; i++) {
			for (let j = i + 1; j < groups.length; j++) {
				const a = groups[i];
				const b = groups[j];
				const asKeys = (g: (typeof groups)[number]) => ({
					paths: [...g.roots],
					keys: [...g.remotes],
					slugs: [...g.slugs],
				});
				// Checked BOTH ways. `shares` compares a group's roots against
				// the candidate's slugs, so a group holding only a slug and a
				// group holding only a root never link in one direction -- which
				// is exactly the case where a memory project and a session path
				// describe the same repository.
				if (!shares(a, asKeys(b)) && !shares(b, asKeys(a))) continue;
				for (const root of b.roots) a.roots.add(root);
				for (const remote of b.remotes) a.remotes.add(remote);
				for (const slug of b.slugs) a.slugs.add(slug);
				for (const path of b.observed) a.observed.add(path);
				a.names.push(...b.names);
				for (const key of Object.keys(a.counts) as (keyof ProjectCounts)[]) {
					a.counts[key] += b.counts[key];
				}
				groups.splice(j, 1);
				merged = true;
				break outer;
			}
		}
	}

	return groups
		.map((group) => {
			// Shortest root: the repository, not a subdirectory of it.
			const root = [...group.roots].sort((a, b) => a.length - b.length)[0];
			const slug =
				[...group.slugs][0] ?? (root ? slugForPath(root) : undefined);
			const gitRemote = [...group.remotes][0];
			// A slug-only project has no path to take a basename from, so the
			// last segment of the slug is used. Clearly a display guess -- the
			// segments came from a lossy transform -- so it is never used as an
			// identity, only as a label.
			const fromSlug = slug?.split("-").filter(Boolean).pop();
			const name =
				group.names[0] ??
				gitRemote?.split("/").pop() ??
				root?.split("/").filter(Boolean).pop() ??
				fromSlug ??
				"unknown";
			return {
				id: root ?? `slug:${slug}`,
				name,
				root,
				gitRemote,
				slug,
				// Roots first: they are the keys most records carry.
				paths: [...new Set([...group.roots, ...group.observed])],
				counts: group.counts,
			};
		})
		.sort(
			(a, b) =>
				total(b.counts) - total(a.counts) || a.name.localeCompare(b.name),
		);
}

export function total(counts: ProjectCounts): number {
	return counts.sessions + counts.memory + counts.research + counts.changes;
}

/** Find the identity a caller named, by id. */
export function findProject(
	projects: ProjectIdentity[],
	id: string | undefined,
): ProjectIdentity | undefined {
	if (!id) return undefined;
	return projects.find((p) => p.id === id);
}
