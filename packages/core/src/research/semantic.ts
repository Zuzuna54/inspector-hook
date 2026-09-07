/**
 * The semantic half of M4's hybrid retrieval.
 *
 * ## What this is, and honestly what it is not
 *
 * The plan specifies "hybrid BM25 + local embeddings, offline, no API key",
 * with the library choice left open and one constraint set: Node 22, minimal
 * deps, no native-build pain, no server. It also records, as Open Risk 3, that
 * a local embedding model "may push us to BM25-only for v1".
 *
 * This is neither of those. It is not neural embeddings, and it does not
 * pretend to be — a caller wanting sentence-transformer semantics should say
 * so, because the honest answer is that this project does not have them.
 *
 * What it is: **query expansion learned from the corpus itself**, by term
 * co-occurrence. The gap BM25 leaves is that a search for "how do I stop the
 * store growing" cannot reach a document about "retention" unless that word
 * appears in the query. Expansion closes exactly that gap, using nothing but
 * the documents already indexed — no model, no download, no dependency, and
 * the associations are the user's own vocabulary rather than a generic
 * pretrained one.
 *
 * ## MEASURED, AND IT DOES NOT WORK. OFF BY DEFAULT.
 *
 * The claim above — that this is a real improvement over lexical-only — was my
 * expectation, and it is wrong. Measured against the live corpus of 569 items
 * on three queries whose correct answers are known:
 *
 *     "stop the store growing"      lexical #4    hybrid #none   LEXICAL BETTER
 *     "tool call reported wrong"    lexical #1    hybrid #1      tie
 *     "writing outside the folder"  neither found                tie
 *
 * Hybrid better on 0 of 3. It also expanded queries with `9e1a`, `4124` and
 * `501` before filtering, and with `message`, `false` and `running` after —
 * terms that co-occur for reasons unrelated to meaning, because this corpus is
 * conversational text where the frequent words are the vocabulary of the
 * conversation rather than of any topic.
 *
 * So `semantic` DEFAULTS TO FALSE. The code stays because the interface is the
 * right one — a real embedding model drops in behind `expand()` without
 * touching the index or the callers — and because a rejected approach is worth
 * more recorded than deleted. The plan anticipated this exact outcome in Open
 * Risk 3: "may push us to BM25-only for v1." It did.
 *
 * What would actually close the gap is sentence embeddings, which need a model
 * download and would be this project's first runtime dependency. That is a
 * decision for the user, not something to approximate badly and call done.
 *
 * ## Why association is scored the way it is
 *
 * Raw co-occurrence counts rank common words highest — "the" co-occurs with
 * everything. The score below is a normalised association, close to pointwise
 * mutual information: how much more often two terms appear together than their
 * independent frequencies predict. A term that appears everywhere predicts
 * nothing and scores near zero.
 */

import type { Bm25Index } from "./bm25.js";
import { tokenize } from "./bm25.js";

/** How many expansion terms a single query term may contribute. */
export const EXPANSIONS_PER_TERM = 3;

/**
 * Weight of an expanded term relative to one the user typed.
 *
 * Deliberately low. An expansion is a guess about intent, and a guess must
 * never outrank the words actually asked for — a query for `retention` that
 * returned documents about `cleanup` above documents about `retention` would
 * be worse than no expansion at all.
 */
export const EXPANSION_WEIGHT = 0.35;

/**
 * A term must appear in at least this many documents before it can be
 * associated with anything.
 *
 * Below this the association is one or two coincidences, and expansion on
 * coincidence is how a search engine starts returning confident nonsense.
 */
const MIN_DOC_FREQUENCY = 5;

/**
 * A term must look like a word to be offered as an expansion.
 *
 * The first run of this on the real corpus expanded "tool call reported wrong"
 * with `4124`, `4d0304e09f79` and `501` — a line number, a git hash and a uid,
 * each co-occurring with the query terms for reasons that have nothing to do
 * with meaning. Identifiers are exactly what BM25 is already good at matching
 * literally, and exactly what expansion should never guess with.
 */
function isWordLike(term: string): boolean {
	if (term.length < 4) return false;
	if (!/[a-z]/.test(term)) return false;
	// Hex-ish or mostly digits: an id, not a word.
	if (/^[0-9a-f]{6,}$/.test(term)) return false;
	if ((term.match(/\d/g)?.length ?? 0) * 2 > term.length) return false;
	return true;
}

/**
 * Common English words that survive the BM25 stop list because they are rare
 * enough there, but carry no meaning as expansions.
 *
 * Kept short and evidence-driven: every word here was observed being offered
 * as an expansion on the real corpus.
 */
const NOT_MEANINGFUL = new Set([
	"there", "none", "whole", "cmd", "fresh", "eight", "here", "these", "those",
	"which", "where", "when", "what", "than", "then", "them", "some", "same",
	"only", "also", "into", "over", "under", "after", "before", "again", "still",
	"just", "like", "make", "made", "does", "done", "each", "both", "every",
	"other", "such", "very", "much", "more", "most", "less", "least", "would",
	"could", "should", "might", "must", "shall", "will", "been", "being", "have",
	"having", "with", "without", "about", "above", "below", "between",
]);

/**
 * A term appearing in more than this fraction of the corpus is too common to
 * carry meaning, and is never offered as an expansion.
 */
const MAX_DOC_RATIO = 0.25;

export interface Association {
	term: string;
	score: number;
}

/**
 * Term associations mined from an index, built once and reused.
 *
 * Construction is O(terms x docs-per-term²) in the worst case, so it is capped
 * and built lazily: a search must not pay for the whole vocabulary when it
 * needs associations for three words.
 */
export class SemanticExpander {
	private readonly docsByTerm = new Map<string, Set<string>>();
	private readonly cache = new Map<string, Association[]>();
	private totalDocs = 0;

	/**
	 * Build from an index's postings.
	 *
	 * Takes the postings rather than the documents so nothing is re-tokenised,
	 * and so this stays a view over what is already indexed instead of a second
	 * copy that can drift from it.
	 */
	constructor(index: Bm25Index) {
		const snapshot = index.toJSON();
		this.totalDocs = snapshot.docs.length;
		for (const [term, posting] of Object.entries(snapshot.postings)) {
			const docs = new Set<string>();
			for (const key of Object.keys(posting)) {
				const id = snapshot.docs[Number(key)];
				if (id !== undefined) docs.add(id);
			}
			if (docs.size >= MIN_DOC_FREQUENCY) this.docsByTerm.set(term, docs);
		}
	}

	get vocabulary(): number {
		return this.docsByTerm.size;
	}

	/**
	 * Terms most associated with `term`, strongest first.
	 *
	 * Returns nothing for a term the corpus has too little evidence about,
	 * which is the common case for a typo or a proper noun — and returning
	 * nothing is the right answer there, not a nearest guess.
	 */
	associate(term: string, limit = EXPANSIONS_PER_TERM): Association[] {
		const cached = this.cache.get(term);
		if (cached) return cached.slice(0, limit);

		const docs = this.docsByTerm.get(term);
		if (!docs || this.totalDocs === 0) {
			this.cache.set(term, []);
			return [];
		}

		const maxDocs = this.totalDocs * MAX_DOC_RATIO;
		if (docs.size > maxDocs) {
			// The term itself is too common to have meaningful associates.
			this.cache.set(term, []);
			return [];
		}

		const scored: Association[] = [];
		for (const [other, otherDocs] of this.docsByTerm) {
			if (other === term) continue;
			if (otherDocs.size > maxDocs) continue;
			if (!isWordLike(other) || NOT_MEANINGFUL.has(other)) continue;

			// Intersect over the smaller set.
			const [small, large] =
				docs.size < otherDocs.size ? [docs, otherDocs] : [otherDocs, docs];
			let shared = 0;
			for (const d of small) if (large.has(d)) shared++;
			if (shared < MIN_DOC_FREQUENCY) continue;

			// Normalised association: observed co-occurrence over what independent
			// frequencies would predict. Common terms land near 1 and are dropped.
			const expected = (docs.size * otherDocs.size) / this.totalDocs;
			const lift = shared / Math.max(expected, 1e-9);
			if (lift <= 1) continue;
			scored.push({ term: other, score: Math.log(lift) });
		}

		scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
		this.cache.set(term, scored);
		return scored.slice(0, limit);
	}

	/**
	 * Expand a query into weighted terms.
	 *
	 * The user's own words always carry weight 1; expansions carry less. The
	 * result is stable for a given corpus and query, which matters because an
	 * unstable ranking cannot be reasoned about or tested.
	 */
	expand(query: string): { term: string; weight: number; typed: boolean }[] {
		const typed = [...new Set(tokenize(query))];
		const out = typed.map((term) => ({ term, weight: 1, typed: true }));
		const seen = new Set(typed);

		for (const term of typed) {
			for (const assoc of this.associate(term)) {
				if (seen.has(assoc.term)) continue;
				seen.add(assoc.term);
				out.push({
					term: assoc.term,
					weight: EXPANSION_WEIGHT,
					typed: false,
				});
			}
		}
		return out;
	}
}
