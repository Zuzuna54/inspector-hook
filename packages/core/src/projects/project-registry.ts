/**
 * Gathering the observations that become the project list.
 *
 * Separated from `project-identity.ts` so that module stays pure: identity and
 * matching are decidable from their arguments and testable without a store,
 * while this one knows where to look.
 *
 * Every source is read independently and every failure is contained. A source
 * that throws contributes nothing rather than emptying the list -- a project
 * picker that silently loses an entry would scope a view to a project that
 * looks absent, which is the same "looks fine, shows nothing" failure the
 * three-valued matcher exists to prevent.
 */

import { dirname } from "node:path";

import type {
	FileChange,
	MemoryProject,
	Session,
} from "@inspector-hook/protocol";

import type { ResearchIndex } from "../research/research-index.js";
import {
	buildProjects,
	type ProjectIdentity,
	type ProjectObservation,
} from "./project-identity.js";

export interface ProjectSources {
	sessions: () => Promise<Session[]>;
	memoryProjects: () => Promise<MemoryProject[]>;
	changes: () => Promise<FileChange[]>;
	research: () => ResearchIndex;
	/** The workspace this core was started for, so it is always offered. */
	workspaceRoot?: string;
}

/**
 * Every project this core can see, newest-weighted first.
 *
 * The research index is asked for its project keys rather than its `stats()`,
 * and that is deliberate: `stats().byProject` is keyed on
 * `projectName ?? projectKey` -- a DISPLAY name. Building the picker from it
 * would offer labels like `inspector-hook` that `search({projectKey})` cannot
 * match, because the key it wants is `Zuzuna54/inspector-hook`. That mismatch
 * is a real reported defect; this reads keys, not labels.
 */
export async function listProjects(
	sources: ProjectSources,
): Promise<ProjectIdentity[]> {
	const observations: ProjectObservation[] = [];

	if (sources.workspaceRoot) {
		observations.push({
			candidate: { path: sources.workspaceRoot },
			source: "sessions",
		});
	}

	const [sessions, memory, changes] = await Promise.allSettled([
		sources.sessions(),
		sources.memoryProjects(),
		sources.changes(),
	]);

	if (sessions.status === "fulfilled") {
		for (const session of sessions.value) {
			const path = session.metadata?.workingDirectory;
			if (!path) continue;
			observations.push({
				candidate: { path },
				source: "sessions",
				name: session.metadata?.projectName,
			});
		}
	}

	if (memory.status === "fulfilled") {
		for (const project of memory.value) {
			observations.push({
				// `workspacePath` is resolvable on 0 of 10 real projects, so the
				// slug is all there is. It is compared against slugs computed
				// from known paths, never parsed back into one.
				candidate: { slug: project.slug, path: project.workspacePath },
				source: "memory",
			});
		}
	}

	if (changes.status === "fulfilled") {
		for (const change of changes.value) {
			if (!change.filePath) continue;
			// The DIRECTORY, not the file. `resolveProject` falls back to the
			// path it was handed when it finds no repository, so passing a file
			// made every file outside a repo its own project -- measured: four
			// plan documents and scratchpad scripts each became a "project".
			observations.push({
				candidate: { path: dirname(change.filePath) },
				source: "changes",
			});
		}
	}

	try {
		for (const key of researchKeys(sources.research())) {
			observations.push({ candidate: { projectKey: key }, source: "research" });
		}
	} catch {
		// The index may not have loaded. Its absence costs the other sources
		// nothing.
	}

	return buildProjects(observations);
}

/**
 * The research index's actual project KEYS.
 *
 * There is no accessor for them, and `stats()` reports display names, so this
 * reads them off a broad search. Terms rather than an empty query because an
 * empty one short-circuits before it can match anything, and stop words alone
 * match nothing -- both return zero and look like an empty corpus.
 */
function researchKeys(index: ResearchIndex): string[] {
	const keys = new Set<string>();
	const result = index.search(
		"context session file hook plan test code build search project error fix",
		{ limit: 5000 },
	);
	for (const hit of result.hits) {
		if (hit.item.projectKey) keys.add(hit.item.projectKey);
	}
	return [...keys];
}
