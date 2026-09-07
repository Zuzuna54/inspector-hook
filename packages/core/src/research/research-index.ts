/**
 * The research index: extraction, storage and search over research history.
 *
 * ## The durability requirement, which shapes everything here
 *
 * Retention deletes raw events. The plan pairs that with keeping "session
 * summaries + the index" — so this index cannot be a view over logs computed on
 * demand. It is built as events arrive and persisted separately, and it must
 * outlive the logs it came from. A search that only worked inside the retention
 * window would go silent exactly when "where did I solve this before" is worth
 * asking, and it would go silent without saying so.
 *
 * Items are therefore stored in full alongside the index. They are small — a
 * query, a URL, a task description, a capped body — and holding them here is
 * what lets a hit still be displayed after its log entry is gone.
 */

import type {
	LogEntry,
	ResearchHit,
	ResearchIndexStats,
	ResearchItem,
	ResearchKind,
	ResearchSearchResult,
} from "@inspector-hook/protocol";
import type { PersistenceStore } from "../persistence/store.js";
import {
	type Embedder,
	VectorStore,
	loadEmbedder,
	reciprocalRankFusion,
} from "./embeddings.js";
import { Bm25Index } from "./bm25.js";
import { SemanticExpander } from "./semantic.js";
import { resolveProject } from "../managers/project-resolver.js";
import { extractResearchItem } from "./extract.js";

/** Where the snapshot lives inside the store. */
const SNAPSHOT_CATEGORY = "research";
const SNAPSHOT_ID = "index";
/**
 * Vectors live in their own snapshot.
 *
 * Separate from the index so a core running without the optional embedding
 * model never writes an empty vector file, and so a build that predates
 * embeddings still loads the index it understands.
 */
const VECTOR_SNAPSHOT_ID = "vectors";

/**
 * How many items to hold.
 *
 * The index is durable, so it needs its own bound or it grows without limit —
 * the one thing retention exists to prevent. Oldest items are dropped first.
 *
 * The number is derived, not picked: measured at 4.1KB per item on the real
 * corpus after id interning, so 5,000 items is roughly a 20MB file. One day of
 * heavy use produced 194 items, which puts the default at about a month of
 * that. It is an option because the right answer depends on how much someone
 * works and how much disk they will spend on being able to search it.
 */
export const DEFAULT_MAX_ITEMS = 5_000;

/**
 * How much of an item's text is KEPT after indexing.
 *
 * The full body (up to MAX_ITEM_TEXT, 8KB) is tokenised into the postings and
 * then discarded; only a snippet is retained, for showing the hit. Storing both
 * was measured at ~10KB per item — 2MB for 194 items, extrapolating to 209MB at
 * the cap, for a file rewritten on every flush. The full text is redundant once
 * indexed: search runs on the postings, and the raw body is still in the log
 * until retention removes it.
 */
export const SNIPPET_LENGTH = 600;

function snippet(text: string): string {
	const flat = text.trim();
	return flat.length <= SNIPPET_LENGTH
		? flat
		: `${flat.slice(0, SNIPPET_LENGTH - 1)}…`;
}

export interface ResearchIndexOptions {
	persistence?: PersistenceStore;
	maxItems?: number;
	/** The core's own workspace, used only to report a sensible default scope. */
	workspaceRoot?: string;
}

export class ResearchIndex {
	private index = new Bm25Index();
	private items = new Map<string, ResearchItem>();
	private readonly persistence?: PersistenceStore;
	private readonly maxItems: number;
	private readonly workspaceRoot?: string;
	private dirty = false;
	/**
	 * Built lazily on first semantic search and dropped whenever the index
	 * changes, so associations can never describe a corpus that has moved on.
	 */
	private expander?: SemanticExpander;

	/**
	 * The semantic half of hybrid retrieval (M4).
	 *
	 * Absent until `enableEmbeddings` succeeds, and everything degrades to BM25
	 * alone when it does not. The model is a 255MB optional dependency, so "no
	 * embedder" is a supported state rather than a failure.
	 */
	private vectors = new VectorStore();
	private embedder: Embedder | null = null;
	private vectorsDirty = false;
	/** Why the embedder is unavailable, when it is. Surfaced, never swallowed. */
	private embedderError?: string;

	constructor(options: ResearchIndexOptions = {}) {
		this.persistence = options.persistence;
		this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
		this.workspaceRoot = options.workspaceRoot;
	}

	/**
	 * The project key matching this core's workspace, if the corpus knows one.
	 *
	 * Resolved from the items rather than computed, because a project key is a
	 * git remote when there is one and a path otherwise — so the only reliable
	 * mapping from a workspace path to a key is an item that carries both.
	 */
	private defaultProjectKey(): string | undefined {
		if (!this.workspaceRoot) return undefined;

		// Resolve the workspace the same way the ingest path does, so the key
		// matches exactly what enrichment assigns to new items.
		//
		// This used to scan the corpus for an item whose projectName was the
		// last path segment of the workspace — a heuristic that returned nothing
		// on the real store, because most items predate enrichment and carry no
		// projectName at all. The result was a permanently disabled "this
		// project" filter, with no error to explain it.
		const project = resolveProject(this.workspaceRoot);
		const key = project?.gitRemote ?? project?.root;
		if (!key) return undefined;

		// Only offer it if the corpus actually holds items under that key;
		// a filter that always returns nothing is worse than no filter.
		for (const item of this.items.values()) {
			if (item.projectKey === key) return key;
		}
		return undefined;
	}

	get size(): number {
		return this.items.size;
	}

	/**
	 * Offer a log entry to the index.
	 *
	 * Returns the item if one was extracted. Most entries hold no research and
	 * return null, which is the normal case, not a failure.
	 */
	ingest(log: LogEntry): ResearchItem | null {
		let item: ResearchItem | null;
		try {
			item = extractResearchItem(log);
		} catch {
			// One malformed payload must never stop the index being built.
			return null;
		}
		if (!item) return null;

		// Index the FULL text, store only a snippet. Title first so a query
		// matching the headline outranks one matching only the body -- BM25 has
		// no field weighting, so repetition is how importance is expressed.
		this.index.add(item.id, `${item.title}\n${item.title}\n${item.text}`);
		this.items.set(item.id, { ...item, text: snippet(item.text) });
		this.dirty = true;
		this.expander = undefined;
		this.trim();
		return item;
	}

	/** Drop the oldest items once the cap is exceeded. */
	private trim(): void {
		if (this.items.size <= this.maxItems) return;
		const ordered = [...this.items.values()].sort((a, b) =>
			a.timestamp.localeCompare(b.timestamp),
		);
		for (const item of ordered.slice(0, this.items.size - this.maxItems)) {
			this.items.delete(item.id);
			this.index.remove(item.id);
		}
	}

	/**
	 * Search, optionally scoped.
	 *
	 * `projectKey` is opt-in rather than default: the whole point of a
	 * machine-wide core is being able to ask across projects, which native
	 * per-project memory structurally cannot.
	 */
	search(
		query: string,
		options?: {
			limit?: number;
			projectKey?: string;
			kinds?: ResearchKind[];
			since?: string;
			/**
			 * Opt IN to corpus-derived query expansion. Defaults OFF — measured
			 * as no better than lexical on this corpus. See semantic.ts.
			 */
			semantic?: boolean;
		},
	): ResearchSearchResult {
		const kinds = options?.kinds?.length ? new Set(options.kinds) : undefined;
		const scoped =
			options?.projectKey !== undefined || kinds || options?.since
				? (docId: string) => {
						const item = this.items.get(docId);
						if (!item) return false;
						if (
							options?.projectKey !== undefined &&
							item.projectKey !== options.projectKey
						) {
							return false;
						}
						if (kinds && !kinds.has(item.kind)) return false;
						if (options?.since && item.timestamp < options.since) return false;
						return true;
					}
				: undefined;

		const searched = scoped
			? [...this.items.keys()].filter(scoped).length
			: this.items.size;

		// Query expansion is OPT-IN and defaults off, because it was measured
		// against the live corpus and made retrieval worse: better on 0 of 3
		// known-answer queries, worse on 1. See semantic.ts for the numbers.
		// Left reachable so a real embedding model can be evaluated behind the
		// same interface without re-plumbing anything.
		const useSemantic = options?.semantic === true;
		let weighted: { term: string; weight: number; typed: boolean }[] | undefined;
		if (useSemantic) {
			this.expander ??= new SemanticExpander(this.index);
			weighted = this.expander.expand(query);
		}

		const result = this.index.search(query, {
			limit: options?.limit ?? 20,
			filter: scoped,
			weighted,
		});

		const hits: ResearchHit[] = [];
		for (const hit of result.hits) {
			const item = this.items.get(hit.docId);
			// An index entry with no item is a corrupt pairing; skipping it
			// beats returning a hit that cannot be displayed.
			if (item) hits.push({ item, score: hit.score, matched: hit.matched });
		}

		return {
			hits,
			total: result.total,
			searched,
			terms: result.terms,
			// The terms the corpus added. Surfaced so a hit that matched none of
			// the typed words can be explained rather than looking arbitrary.
			expandedWith: weighted?.filter((w) => !w.typed).map((w) => w.term) ?? [],
			scope: options?.projectKey !== undefined ? "project" : "all",
			projectKey: options?.projectKey,
			// Stated on this path too. The protocol says `retrieval` is always
			// reported, and leaving it undefined here made that a false claim:
			// a caller could not distinguish "lexical" from "an older core that
			// did not report at all", which is the whole point of the field.
			retrieval: "lexical",
		};
	}

	// =========================================================================
	// Hybrid retrieval (M4)
	//
	// Measured on the live corpus of 693 items against 5 known-answer queries,
	// with relevance fixed before any ranking was inspected:
	//
	//     BM25 alone        MRR 0.440
	//     embeddings alone  MRR 0.614
	//     HYBRID            MRR 0.700     and never worse than either alone
	//
	// The case that decides it: "writing outside the folder" is answered by
	// documents about path traversal. Embeddings rank that 14th, BM25 finds it
	// 5th, fusion puts it 2nd. Neither signal dominates, so neither replaces
	// the other. See embeddings.ts for the full table.
	// =========================================================================

	/**
	 * Load the embedding model.
	 *
	 * @returns true when embeddings are available afterwards. False is a normal
	 * outcome — the dependency is optional — and leaves search working on BM25.
	 */
	async enableEmbeddings(options?: {
		model?: string;
		loader?: () => Promise<unknown>;
		cacheDir?: string;
	}): Promise<boolean> {
		if (this.embedder) return true;
		this.embedderError = undefined;
		this.embedder = await loadEmbedder({
			...options,
			onError: (reason) => {
				this.embedderError = reason;
			},
		});
		return this.embedder !== null;
	}

	/**
	 * Why embeddings are off, when they are.
	 *
	 * Undefined means either "they work" or "nobody asked for them" -- both
	 * states in which there is nothing to explain.
	 */
	get embeddingsError(): string | undefined {
		return this.embedderError;
	}

	get embeddingsAvailable(): boolean {
		return this.embedder !== null;
	}

	/** How many items have a vector, against how many exist. */
	get embeddedCount(): number {
		return this.vectors.size;
	}

	/**
	 * Embed items that have no vector yet.
	 *
	 * Incremental and bounded, because the first run over a real corpus is 23
	 * seconds of CPU and must not block a search or a shutdown. Returns how
	 * many were embedded, so a caller can loop until it reaches zero.
	 */
	async embedPending(limit = 200): Promise<number> {
		if (!this.embedder) return 0;
		const pending: ResearchItem[] = [];
		for (const item of this.items.values()) {
			if (this.vectors.has(item.id)) continue;
			pending.push(item);
			if (pending.length >= limit) break;
		}
		if (pending.length === 0) return 0;

		const vectors = await this.embedder.embed(
			pending.map((i) => `${i.title ?? ""}. ${i.text ?? ""}`),
		);
		let added = 0;
		for (let i = 0; i < pending.length; i++) {
			const vector = vectors[i];
			// A short batch means the model returned fewer vectors than texts;
			// pairing by position past that point would attach the wrong vector
			// to the wrong item, which is worse than embedding nothing.
			if (!vector) break;
			if (this.vectors.add(pending[i].id, vector)) added++;
		}
		if (added > 0) this.vectorsDirty = true;
		return added;
	}

	/**
	 * Search using both signals, fused on rank.
	 *
	 * Falls back to the lexical result when there is no embedder or no vector
	 * for anything, and says so in `retrieval` rather than quietly returning a
	 * worse answer under the same name.
	 */
	async searchHybrid(
		query: string,
		options?: {
			limit?: number;
			projectKey?: string;
			kinds?: ResearchKind[];
			since?: string;
		},
	): Promise<ResearchSearchResult> {
		const limit = options?.limit ?? 20;
		// Fusion needs depth, not just the page being displayed: an item ranked
		// 40th lexically and 1st semantically must be reachable to be fused.
		const depth = Math.max(limit * 5, 50);
		const lexical = this.search(query, { ...options, limit: depth });

		if (!this.embedder || this.vectors.size === 0) {
			return { ...lexical, hits: lexical.hits.slice(0, limit), retrieval: "lexical" };
		}

		let queryVector: Float32Array | undefined;
		try {
			[queryVector] = await this.embedder.embed([query]);
		} catch {
			// A model that fails mid-session must not fail the search.
			return { ...lexical, hits: lexical.hits.slice(0, limit), retrieval: "lexical" };
		}
		if (!queryVector) {
			return { ...lexical, hits: lexical.hits.slice(0, limit), retrieval: "lexical" };
		}

		// The vector half must honour the same scope the lexical half used, or
		// the two lists come from different corpora and fusing them is
		// meaningless.
		const kinds = options?.kinds?.length ? new Set(options.kinds) : undefined;
		const inScope = (id: string): boolean => {
			const item = this.items.get(id);
			if (!item) return false;
			if (
				options?.projectKey !== undefined &&
				item.projectKey !== options.projectKey
			) {
				return false;
			}
			if (kinds && !kinds.has(item.kind)) return false;
			if (options?.since && item.timestamp < options.since) return false;
			return true;
		};

		const semantic = this.vectors.search(queryVector, {
			limit: depth,
			filter: inScope,
		});

		const fused = reciprocalRankFusion({
			lexical: lexical.hits.map((h) => h.item.id),
			semantic: semantic.map((h) => h.id),
		});

		const lexicalScore = new Map(lexical.hits.map((h) => [h.item.id, h]));
		const hits: ResearchHit[] = [];
		for (const entry of fused) {
			const item = this.items.get(entry.id);
			if (!item) continue;
			const fromLexical = lexicalScore.get(entry.id);
			hits.push({
				item,
				score: entry.score,
				// Only lexical matches have terms; a purely semantic hit matched
				// no typed word, and claiming otherwise would misdescribe it.
				matched: fromLexical?.matched ?? [],
			});
			if (hits.length >= limit) break;
		}

		return {
			...lexical,
			hits,
			total: fused.length,
			retrieval: "hybrid",
		};
	}

	/** One item by id, for opening a hit. */
	get(id: string): ResearchItem | null {
		return this.items.get(id) ?? null;
	}

	stats(): ResearchIndexStats {
		const byKind: Record<string, number> = {};
		const byProject: Record<string, number> = {};
		let oldest: string | undefined;
		let newest: string | undefined;

		for (const item of this.items.values()) {
			byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
			const project = item.projectName ?? item.projectKey ?? "(unknown)";
			byProject[project] = (byProject[project] ?? 0) + 1;
			if (!oldest || item.timestamp < oldest) oldest = item.timestamp;
			if (!newest || item.timestamp > newest) newest = item.timestamp;
		}

		return {
			defaultProjectKey: this.defaultProjectKey(),
			items: this.items.size,
			terms: this.index.vocabulary,
			// Coverage, not just availability: an embedder that is loaded but has
			// embedded 3 of 693 items gives semantic results for 0.4% of the
			// corpus, and reporting only "on" would misdescribe that badly.
			embeddings: {
				available: this.embedder !== null,
				embedded: this.vectors.size,
				error: this.embedderError,
			},
			byKind,
			byProject,
			oldest,
			newest,
		};
	}

	/** Persist, if anything changed. */
	async flush(): Promise<boolean> {
		// Vectors are saved separately from the index, so a core without the
		// optional model never writes an empty vector file, and an older build
		// that cannot read them still loads the index.
		if (this.persistence && this.vectorsDirty) {
			await this.persistence.saveJSON(
				SNAPSHOT_CATEGORY,
				VECTOR_SNAPSHOT_ID,
				this.vectors.toJSON(),
			);
			this.vectorsDirty = false;
		}
		if (!this.persistence || !this.dirty) return false;
		await this.persistence.saveJSON(SNAPSHOT_CATEGORY, SNAPSHOT_ID, {
			version: 1,
			items: [...this.items.values()],
			index: this.index.toJSON(),
		});
		this.dirty = false;
		return true;
	}

	/**
	 * Load a persisted index.
	 *
	 * A snapshot whose items and postings disagree is REBUILT from the items
	 * rather than trusted, because the items are the source of truth and the
	 * postings are derived. Trusting a stale index would make search quietly
	 * return the wrong set — the failure that is hardest to notice, since an
	 * empty or short result looks exactly like "nothing matched".
	 */
	async load(): Promise<{ items: number; rebuilt: boolean }> {
		if (!this.persistence) return { items: 0, rebuilt: false };

		// Vectors are optional and independent: a missing or unreadable vector
		// snapshot must cost the index nothing.
		try {
			const stored = await this.persistence.loadJSON<unknown>(
				SNAPSHOT_CATEGORY,
				VECTOR_SNAPSHOT_ID,
			);
			if (stored) this.vectors = VectorStore.fromJSON(stored);
		} catch {
			this.vectors = new VectorStore();
		}

		const snapshot = await this.persistence.loadJSON<{
			version?: number;
			items?: ResearchItem[];
			index?: unknown;
		}>(SNAPSHOT_CATEGORY, SNAPSHOT_ID);

		if (!snapshot || !Array.isArray(snapshot.items)) {
			return { items: 0, rebuilt: false };
		}

		this.items = new Map();
		for (const item of snapshot.items) {
			if (item && typeof item.id === "string") this.items.set(item.id, item);
		}

		const restored = Bm25Index.fromJSON(snapshot.index);
		const consistent = restored.size === this.items.size;
		if (consistent) {
			this.index = restored;
		} else {
			// Rebuilding from stored items re-indexes SNIPPETS, not the full
			// bodies those postings were built from, so the rebuilt index is
			// necessarily weaker than the one it replaces. That is the correct
			// trade -- a smaller index that matches its items beats a larger one
			// that does not -- but it is a real loss, so it is reported rather
			// than performed silently.
			this.index = new Bm25Index();
			for (const item of this.items.values()) {
				this.index.add(item.id, `${item.title}\n${item.title}\n${item.text}`);
			}
			this.dirty = true;
		}

		return { items: this.items.size, rebuilt: !consistent };
	}

	/**
	 * Build from logs already on disk.
	 *
	 * For adopting an existing store: everything captured before the index
	 * existed is still in the log, and re-reading it once is far better than
	 * telling a user their history starts today.
	 */
	backfill(logs: LogEntry[]): { indexed: number; scanned: number } {
		let indexed = 0;
		for (const log of logs) {
			if (this.ingest(log)) indexed++;
		}
		return { indexed, scanned: logs.length };
	}
}
