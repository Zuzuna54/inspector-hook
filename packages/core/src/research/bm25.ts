/**
 * BM25 ranked retrieval over research history.
 *
 * ## Why hand-rolled, and why BM25 alone for now
 *
 * The plan calls for hybrid BM25 + local embeddings. The BM25 half is ~200
 * lines, has no dependencies, runs offline, needs no model download, and is
 * auditable end to end — which matters in a tool whose entire premise is that
 * its output can be trusted. The embedding half needs a ~50MB model fetched at
 * first use, and would be this project's first runtime dependency.
 *
 * So the lexical half ships now and the scorer is kept behind a boundary:
 * `search()` produces candidates and scores them, and a semantic reranker can
 * be layered on the same postings without restructuring. That is a deliberate
 * staging, not an omission — it is recorded in the M4 notes as such.
 *
 * ## Correctness notes
 *
 * The scoring is textbook Okapi BM25:
 *
 *   score(D,Q) = Σ IDF(q) · f(q,D)·(k1+1) / ( f(q,D) + k1·(1 − b + b·|D|/avgdl) )
 *   IDF(q)     = ln( 1 + (N − n(q) + 0.5) / (n(q) + 0.5) )
 *
 * The `1 +` inside the IDF logarithm is load-bearing: without it a term
 * appearing in more than half the documents scores NEGATIVE, and a document
 * can be pushed down the ranking for containing a query term. Common terms
 * should contribute little, never less than nothing.
 */

/** Standard parameters. k1 controls term-frequency saturation, b length normalisation. */
export const K1 = 1.2;
export const B = 0.75;

/**
 * Words carried by nearly every document, which cost vocabulary and contribute
 * no discrimination. Deliberately short: over-aggressive stop-listing breaks
 * exact-phrase recall, and BM25's IDF already suppresses common terms. Kept for
 * the ones frequent enough to bloat the postings.
 */
const STOP_WORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has",
	"have", "he", "in", "is", "it", "its", "of", "on", "or", "she", "that", "the",
	"they", "this", "to", "was", "were", "will", "with", "you", "your",
]);

/**
 * Split text into terms.
 *
 * Tuned for a corpus that is half prose and half code. Underscores and dots are
 * separators so `tool_use_id` and `file-tracker.ts` are findable by their
 * parts, and single characters are dropped as noise — but digits are kept,
 * because version numbers and error codes are exactly what someone searches for.
 */
export function tokenize(text: string): string[] {
	if (typeof text !== "string" || text.length === 0) return [];
	const lower = text.toLowerCase();
	const out: string[] = [];

	// Dotted numbers are lifted out whole BEFORE the general split.
	//
	// Splitting first destroys them: "0.1.7" becomes 0, 1, 7 — three
	// single characters, all dropped as noise — so a version number vanishes
	// from the index entirely and searching for it returns nothing at all.
	// Version numbers and error codes are precisely what someone searches a
	// research corpus for, so they are kept as single exact tokens.
	const remainder = lower.replace(/\d+(?:\.\d+)+/g, (version) => {
		out.push(version);
		return " ";
	});

	for (const raw of remainder.split(/[^a-z0-9]+/)) {
		if (raw.length < 2) continue;
		if (STOP_WORDS.has(raw)) continue;
		out.push(raw);
	}
	return out;
}

/**
 * The serialisable form, so an index survives a restart without a rebuild.
 *
 * v2 INTERNS document ids. Measured on the real corpus, a v1 snapshot of 194
 * documents was 1192KB of which 985KB — 83% — was the same 36-character ids
 * repeated once per posting, 28019 times in total. v2 lists each id once and
 * references it by position, which costs nothing in search quality.
 *
 * v1 is still readable. Nothing has shipped that writes it, but an index
 * written by an intermediate build should load rather than silently rebuild.
 */
export interface Bm25SnapshotV1 {
	version: 1;
	/** docId -> token count. */
	lengths: Record<string, number>;
	/** term -> { docId: frequency }. */
	postings: Record<string, Record<string, number>>;
}

export interface Bm25Snapshot {
	version: 2;
	/** Each document id, once. Postings reference these by index. */
	docs: string[];
	/** Token count per document, positionally aligned with `docs`. */
	lengths: number[];
	/** term -> { docIndex: frequency }. */
	postings: Record<string, Record<string, number>>;
}

/**
 * An inverted index with BM25 scoring.
 *
 * Holds only the statistics — the documents themselves live with their caller,
 * so the index stays small and a document can be re-read from its own store
 * without being duplicated here.
 */
export class Bm25Index {
	/** term -> docId -> frequency within that document. */
	private postings = new Map<string, Map<string, number>>();
	/** docId -> token count, for length normalisation. */
	private lengths = new Map<string, number>();
	private totalLength = 0;

	get size(): number {
		return this.lengths.size;
	}

	get vocabulary(): number {
		return this.postings.size;
	}

	/** Mean document length. Zero for an empty index; guarded at every use. */
	get averageLength(): number {
		return this.lengths.size === 0 ? 0 : this.totalLength / this.lengths.size;
	}

	has(docId: string): boolean {
		return this.lengths.has(docId);
	}

	/**
	 * Add or replace a document.
	 *
	 * Replacing removes the old postings first, so re-indexing the same id
	 * cannot double-count its terms — the failure that makes an index quietly
	 * drift from the corpus it claims to describe.
	 */
	add(docId: string, text: string): void {
		if (this.lengths.has(docId)) this.remove(docId);

		const terms = tokenize(text);
		if (terms.length === 0) {
			// Still recorded, so `has()` is true and a re-add replaces rather
			// than appends. A document with no indexable terms is a real state.
			this.lengths.set(docId, 0);
			return;
		}

		const frequencies = new Map<string, number>();
		for (const term of terms) {
			frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
		}
		for (const [term, frequency] of frequencies) {
			let posting = this.postings.get(term);
			if (!posting) {
				posting = new Map();
				this.postings.set(term, posting);
			}
			posting.set(docId, frequency);
		}

		this.lengths.set(docId, terms.length);
		this.totalLength += terms.length;
	}

	/** Remove a document and every posting that referenced it. */
	remove(docId: string): boolean {
		const length = this.lengths.get(docId);
		if (length === undefined) return false;

		for (const [term, posting] of this.postings) {
			if (posting.delete(docId) && posting.size === 0) {
				// Drop the term entirely, or the vocabulary only ever grows and
				// IDF is computed against terms no document contains.
				this.postings.delete(term);
			}
		}
		this.lengths.delete(docId);
		this.totalLength -= length;
		return true;
	}

	/**
	 * Score every document matching at least one query term.
	 *
	 * Returns descending by score. `filter` is applied before scoring so a
	 * scoped search does not pay for documents it will discard.
	 */
	search(
		query: string,
		options?: { limit?: number; filter?: (docId: string) => boolean },
	): { hits: { docId: string; score: number; matched: string[] }[]; total: number; terms: string[] } {
		const terms = [...new Set(tokenize(query))];
		if (terms.length === 0) return { hits: [], total: 0, terms: [] };

		const total = this.lengths.size;
		const avgdl = this.averageLength;
		const scores = new Map<string, number>();
		const matched = new Map<string, string[]>();

		for (const term of terms) {
			const posting = this.postings.get(term);
			if (!posting) continue;

			// The `1 +` prevents a negative IDF for terms in over half the
			// corpus. Without it a common term actively demotes documents that
			// contain it, which inverts the ranking for short queries.
			const n = posting.size;
			const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));

			for (const [docId, frequency] of posting) {
				if (options?.filter && !options.filter(docId)) continue;
				const length = this.lengths.get(docId) ?? 0;
				const norm = avgdl === 0 ? 1 : 1 - B + (B * length) / avgdl;
				const contribution =
					(idf * (frequency * (K1 + 1))) / (frequency + K1 * norm);
				scores.set(docId, (scores.get(docId) ?? 0) + contribution);
				const list = matched.get(docId);
				if (list) list.push(term);
				else matched.set(docId, [term]);
			}
		}

		const ranked = [...scores.entries()]
			.map(([docId, score]) => ({
				docId,
				score,
				matched: matched.get(docId) ?? [],
			}))
			// Ties broken by id so ordering is stable across runs; an unstable
			// ranking makes a result set impossible to reason about or test.
			.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));

		const limit = options?.limit ?? 20;
		return { hits: ranked.slice(0, limit), total: ranked.length, terms };
	}

	/** Serialise for persistence, with document ids interned. */
	toJSON(): Bm25Snapshot {
		const docs: string[] = [];
		const lengths: number[] = [];
		const indexOf = new Map<string, number>();
		for (const [docId, length] of this.lengths) {
			indexOf.set(docId, docs.length);
			docs.push(docId);
			lengths.push(length);
		}

		const postings: Record<string, Record<string, number>> = {};
		for (const [term, posting] of this.postings) {
			const compact: Record<string, number> = {};
			for (const [docId, frequency] of posting) {
				const i = indexOf.get(docId);
				// A posting for a document with no length entry is corrupt
				// bookkeeping; dropping it beats persisting it.
				if (i !== undefined) compact[i] = frequency;
			}
			postings[term] = compact;
		}

		return { version: 2, docs, lengths, postings };
	}

	/**
	 * Rebuild from a snapshot.
	 *
	 * Tolerant of a malformed or future-version snapshot: it returns an empty
	 * index rather than throwing, because a corrupt index should degrade to
	 * "search finds nothing until rebuilt", never to "the core will not start".
	 */
	static fromJSON(snapshot: unknown): Bm25Index {
		const index = new Bm25Index();
		const snap = snapshot as
			| (Partial<Bm25Snapshot> & Partial<Bm25SnapshotV1>)
			| null;
		if (!snap || typeof snap !== "object") return index;
		if (!snap.lengths || !snap.postings) return index;

		// Resolves a posting key to a document id: a position for v2, the id
		// itself for v1.
		let resolve: (key: string) => string | undefined;

		if (snap.version === 2 && Array.isArray(snap.docs) && Array.isArray(snap.lengths)) {
			const docs = snap.docs;
			for (let i = 0; i < docs.length; i++) {
				const length = (snap.lengths as number[])[i];
				if (typeof docs[i] !== "string") continue;
				if (typeof length !== "number" || !Number.isFinite(length)) continue;
				index.lengths.set(docs[i], length);
				index.totalLength += length;
			}
			resolve = (key) => docs[Number(key)];
		} else if (snap.version === 1 && !Array.isArray(snap.lengths)) {
			for (const [docId, length] of Object.entries(
				snap.lengths as Record<string, number>,
			)) {
				if (typeof length !== "number" || !Number.isFinite(length)) continue;
				index.lengths.set(docId, length);
				index.totalLength += length;
			}
			resolve = (key) => key;
		} else {
			return index;
		}

		for (const [term, posting] of Object.entries(snap.postings)) {
			if (!posting || typeof posting !== "object") continue;
			const map = new Map<string, number>();
			for (const [key, frequency] of Object.entries(posting)) {
				const docId = resolve(key);
				// A posting for a document the index does not know about would
				// give that term an IDF computed against a phantom.
				if (
					typeof docId === "string" &&
					typeof frequency === "number" &&
					index.lengths.has(docId)
				) {
					map.set(docId, frequency);
				}
			}
			if (map.size > 0) index.postings.set(term, map);
		}
		return index;
	}
}
