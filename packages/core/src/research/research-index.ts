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
import { Bm25Index } from "./bm25.js";
import { extractResearchItem } from "./extract.js";

/** Where the snapshot lives inside the store. */
const SNAPSHOT_CATEGORY = "research";
const SNAPSHOT_ID = "index";

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
}

export class ResearchIndex {
	private index = new Bm25Index();
	private items = new Map<string, ResearchItem>();
	private readonly persistence?: PersistenceStore;
	private readonly maxItems: number;
	private dirty = false;

	constructor(options: ResearchIndexOptions = {}) {
		this.persistence = options.persistence;
		this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
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

		const result = this.index.search(query, {
			limit: options?.limit ?? 20,
			filter: scoped,
		});

		const hits: ResearchHit[] = [];
		for (const hit of result.hits) {
			const item = this.items.get(hit.docId);
			// An index entry with no item is a corrupt pairing; skipping it
			// beats returning a hit that cannot be displayed.
			if (item) hits.push({ item, score: hit.score, matched: hit.matched });
		}

		return { hits, total: result.total, searched, terms: result.terms };
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
			items: this.items.size,
			terms: this.index.vocabulary,
			byKind,
			byProject,
			oldest,
			newest,
		};
	}

	/** Persist, if anything changed. */
	async flush(): Promise<boolean> {
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
