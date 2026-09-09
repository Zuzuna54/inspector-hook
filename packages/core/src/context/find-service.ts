/**
 * The four-corpus search, assembled.
 *
 * `ContextIndex` ranks the three local corpora; this decides what goes into
 * them, when, and how the fourth is answered.
 *
 * ## The fourth corpus is delegated, not copied
 *
 * Prompts and replies are already indexed by `ResearchIndex` (kinds
 * `user_prompt` and `conclusion`), with embeddings and query expansion this
 * index does not have. Re-indexing them here would produce a second, weaker
 * copy that drifts from the first as one gets ingest events the other misses
 * -- with nothing anywhere reporting the divergence.
 *
 * So that group is forwarded, and the forwarding is visible in the result: its
 * scores come from a different index with a different `avgdl` and a different
 * IDF, which is precisely why the groups are never merged.
 *
 * ## Built on demand, with a staleness window
 *
 * Nothing pushes into this index -- it reads its sources. Rebuilding on every
 * keystroke would re-read every memory file on the machine; rebuilding once at
 * startup would go stale the moment a session ends. So a search rebuilds if
 * the last build is older than `STALE_AFTER_MS`, and `refresh()` forces one.
 *
 * The rebuild is a full replace per corpus rather than an incremental update.
 * Incremental would need every mutation path in the core to remember to notify
 * this index, and the failure mode of forgetting one is a search that silently
 * answers from stale material -- indistinguishable from a search that found
 * nothing.
 */

import type {
	ContextFindResult,
	ContextFindStats,
	ContextGroup,
	ContextHit,
	FileChange,
	MemoryProject,
	Session,
	SessionSummaryRecord,
} from "@inspector-hook/protocol";

import type { SessionDigest } from "../memory/session-digest.js";
import type { ProjectIdentity } from "../projects/project-identity.js";
import type { ResearchIndex } from "../research/research-index.js";
import {
	changedLines,
	digestDoc,
	logDoc,
	fileChangeDoc,
	memoryDoc,
	summaryDoc,
} from "./context-corpus.js";
import { ContextIndex, findResult } from "./context-index.js";

/** How long a build stays usable before a search rebuilds it. */
export const STALE_AFTER_MS = 30_000;

/** How many file changes one rebuild will read, pending and archived each. */
export const CHANGE_SCAN_LIMIT = 5_000;

/** How many events one rebuild will read — the core's in-memory ceiling. */
export const LOG_SCAN_LIMIT = 10_000;

export interface FindSources {
	memoryProjects: () => Promise<MemoryProject[]>;
	sessions: () => Promise<Session[]>;
	digestFor: (session: Session) => Promise<SessionDigest>;
	summaries: () => Promise<SessionSummaryRecord[]>;
	changes: () => Promise<FileChange[]>;
	/** Captured events, so the global search covers them too. */
	logs?: () => Promise<
		{
			id: string;
			timestamp: string;
			message: string;
			hook?: string;
			event?: string;
			tool?: string;
			sessionId?: string;
			level?: string;
		}[]
	>;
	research: () => ResearchIndex;
	/** The reconciled project list, for scoping. */
	projects?: () => Promise<ProjectIdentity[]>;
	storeStats?: () => Promise<ContextFindStats["store"]>;
}

export interface FindOptions {
	/** A project id from `projects.list`. Omitted searches every project. */
	projectId?: string;
	limit?: number;
	/** Rebuild before searching, regardless of age. */
	refresh?: boolean;
}

export class ContextFindService {
	private index = new ContextIndex();
	private builtAt = 0;
	/** In-flight rebuild, so concurrent searches share one pass over disk. */
	private building: Promise<void> | null = null;
	/** session id -> project, so a file change can be attributed. */
	private sessionProjects = new Map<
		string,
		{ projectKey?: string; projectName?: string }
	>();

	constructor(private readonly sources: FindSources) {}

	/** Rebuild every local corpus. Safe to call concurrently. */
	async refresh(): Promise<void> {
		if (this.building) return this.building;
		this.building = this.rebuild().finally(() => {
			this.building = null;
		});
		return this.building;
	}

	private async rebuild(): Promise<void> {
		const next = new ContextIndex();
		// Each source is independent: one throwing must not cost the others
		// their corpus. A corpus that failed to build reports as empty, which
		// `searched: 0` then makes visible rather than silently ranking without
		// it.
		this.sessionProjects = new Map();
		// Memory is independent; changes depend on the session map that
		// loadDigests fills, so those two are sequential. Settled rather than
		// all: one source failing must not cost the others their corpus.
		await Promise.allSettled([
			this.loadMemory(next),
			// Changes AND logs both need the session map that loadDigests fills,
			// so they follow it. Settled rather than all: one source failing
			// must not cost the others their corpus.
			this.loadDigests(next).then(() =>
				Promise.allSettled([this.loadChanges(next), this.loadLogs(next)]),
			),
		]);
		this.index = next;
		this.builtAt = Date.now();
	}

	private async loadMemory(index: ContextIndex): Promise<void> {
		const projects = await this.sources.memoryProjects();
		index.addAll(
			projects.flatMap((project) =>
				project.files.map((file) =>
					memoryDoc(file, {
						slug: project.slug,
						name: project.workspacePath ?? project.slug,
						projectKey: project.workspacePath,
					}),
				),
			),
		);
	}

	/**
	 * Digests for live sessions, then summaries for collapsed ones.
	 *
	 * Summaries are added SECOND on purpose: they share the live digest's id,
	 * so a session that has since been collapsed ends up described by the
	 * record that outlives it rather than by a digest rebuilt from data
	 * retention has already thinned.
	 */
	private async loadDigests(index: ContextIndex): Promise<void> {
		const sessions = await this.sources.sessions();
		// A file change knows its session but not its project, and the session
		// is the only thing that knows both. Built here because this is where
		// the sessions are already loaded.
		for (const session of sessions) {
			const key = session.metadata?.workingDirectory;
			if (key) {
				this.sessionProjects.set(session.id, {
					projectKey: key,
					projectName: session.metadata?.projectName ?? session.name,
				});
			}
		}
		const digests = await Promise.allSettled(
			sessions.map(async (session) => ({
				digest: await this.sources.digestFor(session),
				session,
			})),
		);
		index.addAll(
			digests
				.filter((r) => r.status === "fulfilled")
				.map((r) => (r as PromiseFulfilledResult<{ digest: SessionDigest; session: Session }>).value)
				// A digest that judged itself not worth keeping is not worth
				// searching either — indexing it would put "nothing happened"
				// bodies into the corpus and rank them against real work.
				.filter(({ digest }) => digest.worthKeeping)
				.map(({ digest, session }) =>
					digestDoc(digest, {
						timestamp: session.lastActivityTime ?? session.startTime,
						projectKey: session.metadata?.workingDirectory,
						projectName: session.metadata?.projectName ?? session.name,
					}),
				),
		);

		const summaries = await this.sources.summaries();
		index.addAll(
			summaries
				.map((summary) => summaryDoc(summary))
				.filter((doc): doc is NonNullable<typeof doc> => doc !== null),
		);
	}

	/**
	 * File changes, attributed through the session that made them.
	 *
	 * Without this every file change carries no project identity -- measured at
	 * 0 of 238 on the live store -- so a project-scoped search could never
	 * confirm one as in scope. The session holds the working directory; the
	 * change holds the session.
	 *
	 * Runs after `loadDigests` has filled the map. A change whose session is
	 * gone stays unattributed, which is a real state and is reported as such
	 * rather than guessed at from the file path.
	 */
	private async loadChanges(index: ContextIndex): Promise<void> {
		const changes = await this.sources.changes();
		index.addAll(
			changes
				.slice(0, CHANGE_SCAN_LIMIT)
				.map((change) =>
					fileChangeDoc(change, this.sessionProjects.get(change.sessionId)),
				),
		);
	}

	/**
	 * Events, attributed through the session that produced them.
	 *
	 * A log carries a session id, not a path, so its project comes from the
	 * session map — the same route file changes take. A log whose session is
	 * gone stays unattributed, which the three-valued filter then keeps rather
	 * than hides.
	 */
	private async loadLogs(index: ContextIndex): Promise<void> {
		if (!this.sources.logs) return;
		const logs = await this.sources.logs();
		index.addAll(
			logs.map((log) =>
				logDoc(
					log,
					log.sessionId ? this.sessionProjects.get(log.sessionId) : undefined,
				),
			),
		);
	}

	private stale(): boolean {
		return this.builtAt === 0 || Date.now() - this.builtAt > STALE_AFTER_MS;
	}

	async find(query: string, options: FindOptions = {}): Promise<ContextFindResult> {
		if (options.refresh || this.stale()) await this.refresh();

		const limit = options.limit ?? 20;
		const project = options.projectId
			? (await this.sources.projects?.())?.find((p) => p.id === options.projectId)
			: undefined;

		const groups = this.index.search(query, { project, limit });
		// The research index keys on the GIT REMOTE, so that is what it is given
		// -- passing a path here returned "0 of 0" prompts for a project whose
		// digests and file changes all matched.
		groups.push(this.promptGroup(query, project?.gitRemote, limit));
		return findResult(query, groups, options.projectId);
	}

	/**
	 * The delegated corpus.
	 *
	 * Kind-filtered to the two that are prompts and replies. `ResearchIndex`
	 * holds five other kinds -- web lookups, subagent traffic, file reads --
	 * which belong to the Search view, not here.
	 */
	private promptGroup(
		query: string,
		projectKey: string | undefined,
		limit: number,
	): ContextGroup {
		const empty: ContextGroup = {
			corpus: "prompt",
			hits: [],
			total: 0,
			searched: 0,
			terms: [],
		};

		let research: ResearchIndex;
		try {
			research = this.sources.research();
		} catch {
			return { ...empty, unavailable: "The research index is not available." };
		}

		const result = research.search(query, {
			limit,
			projectKey,
			kinds: ["user_prompt", "conclusion"],
		});

		return {
			corpus: "prompt",
			hits: result.hits.map(
				({ item, score, matched }): ContextHit => ({
					id: item.id,
					corpus: "prompt",
					title: item.title,
					snippet: item.text,
					timestamp: item.timestamp,
					score,
					matched,
					projectKey: item.projectKey,
					projectName: item.projectName,
					sessionId: item.sessionId,
				}),
			),
			total: result.total,
			searched: result.searched,
			terms: result.terms,
		};
	}

	/**
	 * Resolve a hit back to its full source text.
	 *
	 * The index stores a 600-character snippet, never the body. Adding a hit to
	 * the tray from that snippet would put a silently truncated memory file
	 * into an injection while the UI said it had added the file -- so the add
	 * path re-reads the source instead of reusing what the search returned.
	 *
	 * `prompt` is the honest exception: `ResearchIndex` also stores only a
	 * snippet, so the full turn genuinely no longer exists anywhere this core
	 * can reach. It is returned as an excerpt and SAYS it is one, rather than
	 * being presented as the whole turn.
	 */
	async resolveHit(id: string): Promise<{
		kind: "memory_file" | "session_digest" | "file_change" | "free_text";
		title: string;
		text: string;
		excerpt: boolean;
		source: Record<string, string>;
	} | null> {
		const cut = id.indexOf(":");
		if (cut === -1) return null;
		const corpus = id.slice(0, cut);
		const rest = id.slice(cut + 1);

		if (corpus === "memory") {
			const slash = rest.indexOf(":");
			if (slash === -1) return null;
			const slug = rest.slice(0, slash);
			const fileName = rest.slice(slash + 1);
			const projects = await this.sources.memoryProjects();
			const project = projects.find((p) => p.slug === slug);
			const file = project?.files.find((f) => f.fileName === fileName);
			if (!project || !file) return null;
			return {
				kind: "memory_file",
				title: file.name || file.fileName,
				text: file.body,
				excerpt: false,
				source: { memoryDir: project.memoryDir, fileName: file.fileName },
			};
		}

		if (corpus === "digest") {
			const sessions = await this.sources.sessions();
			const session = sessions.find((s) => s.id === rest);
			if (session) {
				const digest = await this.sources.digestFor(session);
				return {
					kind: "session_digest",
					title: digest.title || digest.name,
					text: digest.body,
					excerpt: false,
					source: { sessionId: rest },
				};
			}
			// The session is gone; the summary written when it collapsed is the
			// record that outlived it.
			const summary = (await this.sources.summaries()).find((x) => x.id === rest);
			if (!summary?.digest) return null;
			return {
				kind: "session_digest",
				title: summary.name || summary.description || rest,
				text: summary.digest,
				excerpt: false,
				source: { sessionId: rest },
			};
		}

		if (corpus === "logs") {
			// An event IS resolvable: its full message is in the store. Left
			// unhandled it returned null, which the panel renders as "that
			// result no longer resolves" — a false statement about a record
			// sitting right there, and the button would have been enabled.
			if (!this.sources.logs) return null;
			const log = (await this.sources.logs()).find((l) => l.id === rest);
			if (!log) return null;
			const label = [log.tool, log.hook ?? log.event].filter(Boolean).join(" · ");
			return {
				kind: "free_text",
				title: label || "Event",
				text: [label, log.message].filter(Boolean).join("\n\n"),
				excerpt: false,
				source: log.sessionId ? { sessionId: log.sessionId } : {},
			};
		}

		if (corpus === "filechange") {
			const change = (await this.sources.changes()).find((c) => c.id === rest);
			if (!change) return null;
			// The changed lines ARE the document -- the full file contents are
			// deliberately not indexed and are deliberately not injected either.
			const lines = changedLines(
				change.beforeContent ?? "",
				change.afterContent ?? "",
			);
			return {
				kind: "file_change",
				title: change.filePath,
				text: [change.filePath, "", ...lines].join("\n"),
				excerpt: false,
				source: { changeId: change.id, filePath: change.filePath },
			};
		}

		return null;
	}

	async stats(): Promise<ContextFindStats> {
		if (this.stale()) await this.refresh();
		const corpora = this.index.stats();

		// The delegated corpus reports through the index that owns it, so its
		// document count is that index's, not a number invented here.
		//
		// Kind-filtered, and that is not incidental: `searched` counts what was
		// in scope, so without the filter this would report every research item
		// on the machine -- web lookups, subagent traffic, file reads -- under
		// a heading that says "prompts and replies".
		let promptDocs = 0;
		try {
			promptDocs = this.sources
				.research()
				.search("", { limit: 0, kinds: ["user_prompt", "conclusion"] }).searched;
		} catch {
			promptDocs = 0;
		}
		corpora.push({
			corpus: "prompt",
			documents: promptDocs,
			delegatedTo: "research",
		});

		let store: ContextFindStats["store"];
		try {
			store = await this.sources.storeStats?.();
		} catch {
			store = undefined;
		}

		return { corpora, store };
	}
}
