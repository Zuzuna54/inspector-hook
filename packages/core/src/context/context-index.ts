/**
 * Search across the context corpora.
 *
 * ## Why this is not part of `ResearchIndex`
 *
 * Two measured properties of that index make it the wrong home, and both were
 * re-verified against the current code before this module was written rather
 * than carried over from the plan that first named them:
 *
 * 1. **`trim()` evicts oldest-first against ONE global cap** for every kind it
 *    holds (`research-index.ts`, `DEFAULT_MAX_ITEMS = 5000`). Prompts churn;
 *    memory files do not. Sharing a cap means prompt volume silently evicts
 *    curated memory, and it evicts the oldest -- which is the material most
 *    likely to be the answer to "where did I solve this before".
 * 2. **Its rebuild re-indexes snippets, not bodies.** The code says so itself:
 *    items are stored with `text: snippet(item.text)`, so a rebuilt index has
 *    postings for 600 characters of a document whose original postings came
 *    from the whole thing.
 *
 * ## One BM25 index PER corpus
 *
 * This is the structural answer to (1): a cap per corpus can only be enforced
 * by a corpus that owns its own postings. It also makes the grouping in
 * `ContextFindResult` honest rather than cosmetic -- with separate indexes the
 * scores genuinely are incomparable (different `avgdl`, different IDF for the
 * same term), so there is no arrangement of this data in which merging them
 * into one ranked list would be correct.
 *
 * ## No snapshot, by choice
 *
 * Every local corpus is rebuildable from its own store in under a second, so
 * this index is built at startup and never persisted. That is the direct
 * consequence of defect (2) above: a persisted index has to be rebuildable
 * from what it persisted, and persisting bodies would duplicate the corpus
 * while persisting snippets would degrade it. Holding no snapshot means the
 * index can never disagree with the material it describes.
 */

import type {
	ContextCorpus,
	ContextDoc,
	ContextFindResult,
	ContextFindStats,
	ContextGroup,
	ContextHit,
} from "@inspector-hook/protocol";
import { CONTEXT_CORPUS_CAPS } from "@inspector-hook/protocol";

import { Bm25Index } from "../research/bm25.js";
import {
	matches,
	type ProjectIdentity,
} from "../projects/project-identity.js";
import { LOCAL_CORPORA } from "./context-corpus.js";

/**
 * A memory file's project slug, from its path.
 *
 * `<...>/<slug>/memory/<file>.md`, so the slug is the segment before `memory`.
 * Returns undefined when the path is not that shape rather than taking
 * whatever sits two levels up -- a wrong slug is worse than no slug, because
 * it reads as a confident attribution to the wrong project.
 */
function slugOf(path: string | undefined): string | undefined {
	if (!path) return undefined;
	const parts = path.split("/");
	if (parts.length < 3) return undefined;
	if (parts[parts.length - 2] !== "memory") return undefined;
	return parts[parts.length - 3] || undefined;
}

/**
 * How a document describes itself to the project matcher.
 *
 * A memory file offers its SLUG and never its path. Its path lives under
 * `~/.claude/projects/<slug>/memory/`, which is not a workspace directory --
 * offering it made every memory file look attributable, so instead of being
 * `unknown` and kept, it was `out` and hidden. That is the exact failure the
 * three-valued matcher exists to prevent, reintroduced one field at a time.
 */
function candidateFor(doc: StoredDoc) {
	if (doc.corpus === "memory") {
		return { slug: slugOf(doc.path), projectKey: doc.projectKey };
	}
	return { path: doc.path, projectKey: doc.projectKey };
}

/** What is kept per document. The searchable body is not: see the header. */
type StoredDoc = Omit<ContextDoc, "text">;

interface Corpus {
	index: Bm25Index;
	docs: Map<string, StoredDoc>;
	cap: number;
	evicted: number;
}

export interface ContextSearchOptions {
	/** Which corpora to search. Defaults to every local one. */
	corpora?: ContextCorpus[];
	/**
	 * Restrict to one project.
	 *
	 * An IDENTITY, not a key, because the four corpora key on four different
	 * things: memory on a directory slug, digests and file changes on a working
	 * directory, prompts on a git remote. A single key can only ever match one
	 * of them -- measured, a path-scoped search returned every digest and zero
	 * prompts, because prompts are keyed on `Zuzuna54/inspector-hook`.
	 */
	project?: ProjectIdentity;
	/** Hits per corpus, not in total -- each group is limited separately. */
	limit?: number;
}

export class ContextIndex {
	private corpora = new Map<ContextCorpus, Corpus>();

	constructor(caps: Partial<Record<ContextCorpus, number>> = {}) {
		for (const corpus of LOCAL_CORPORA) {
			this.corpora.set(corpus, {
				index: new Bm25Index(),
				docs: new Map(),
				cap: caps[corpus] ?? CONTEXT_CORPUS_CAPS[corpus],
				evicted: 0,
			});
		}
	}

	/** Documents held, across every local corpus. */
	get size(): number {
		let total = 0;
		for (const corpus of this.corpora.values()) total += corpus.docs.size;
		return total;
	}

	sizeOf(corpus: ContextCorpus): number {
		return this.corpora.get(corpus)?.docs.size ?? 0;
	}

	has(id: string): boolean {
		for (const corpus of this.corpora.values()) {
			if (corpus.docs.has(id)) return true;
		}
		return false;
	}

	/**
	 * Add or replace a document.
	 *
	 * `Bm25Index.add` already replaces rather than appends, so re-adding the
	 * same id cannot double-count its terms. Ids are deterministic per source
	 * (path for memory, session for digests, change id for file changes) so
	 * re-indexing is idempotent by construction rather than by care.
	 */
	add(doc: ContextDoc): boolean {
		const corpus = this.insert(doc);
		if (!corpus) return false;
		this.trim(corpus);
		return true;
	}

	/**
	 * Add many, trimming once per corpus rather than once per document.
	 *
	 * This is a cost difference ONLY -- it does not change which documents
	 * survive, and the reason is worth stating so nobody "fixes" it later
	 * believing they are changing behaviour. Oldest-first eviction is
	 * order-independent: a document dropped mid-batch had `cap` newer documents
	 * present at the time, all of which are still there at the end, so it would
	 * have failed the final trim too. Both orders leave exactly the newest
	 * `cap` documents.
	 *
	 * What it saves is real, though: `trim` sorts the whole corpus, so trimming
	 * per document turns a bulk load of k documents into k sorts of an
	 * n-element corpus instead of one.
	 */
	addAll(docs: Iterable<ContextDoc>): number {
		const touched = new Set<Corpus>();
		let added = 0;
		for (const doc of docs) {
			const corpus = this.insert(doc);
			if (!corpus) continue;
			touched.add(corpus);
			added++;
		}
		for (const corpus of touched) this.trim(corpus);
		return added;
	}

	/** Index a document without enforcing the cap. Returns its corpus. */
	private insert(doc: ContextDoc): Corpus | null {
		const corpus = this.corpora.get(doc.corpus);
		// A delegated corpus has no local index; adding to it would create a
		// second, quietly divergent copy of material ResearchIndex owns.
		if (!corpus) return null;

		const { text, ...stored } = doc;
		corpus.index.add(doc.id, text);
		corpus.docs.set(doc.id, stored);
		return corpus;
	}

	remove(id: string): boolean {
		for (const corpus of this.corpora.values()) {
			if (corpus.docs.delete(id)) {
				corpus.index.remove(id);
				return true;
			}
		}
		return false;
	}

	/** Drop everything in one corpus, for a full refresh of that source. */
	clear(corpus: ContextCorpus): void {
		const held = this.corpora.get(corpus);
		if (!held) return;
		held.index = new Bm25Index();
		held.docs = new Map();
	}

	/**
	 * Enforce this corpus's cap, oldest first.
	 *
	 * Same eviction ORDER as `ResearchIndex.trim`, and deliberately so -- the
	 * objection was never to evicting oldest-first, it was to one corpus's
	 * churn deciding another's evictions. The counter is kept so a corpus
	 * silently running at its ceiling is reportable rather than invisible.
	 */
	private trim(corpus: Corpus): void {
		if (corpus.cap <= 0 || corpus.docs.size <= corpus.cap) return;
		const ordered = [...corpus.docs.values()].sort((a, b) =>
			a.timestamp.localeCompare(b.timestamp),
		);
		for (const doc of ordered.slice(0, corpus.docs.size - corpus.cap)) {
			corpus.docs.delete(doc.id);
			corpus.index.remove(doc.id);
			corpus.evicted++;
		}
	}

	/**
	 * Search the local corpora, one group per corpus.
	 *
	 * The `prompt` group is NOT produced here -- it is delegated, and the
	 * caller merges it in. Doing it here would mean this module holding a
	 * reference to `ResearchIndex` purely to forward a call, and the delegation
	 * belongs where both indexes are already in scope.
	 */
	search(query: string, options: ContextSearchOptions = {}): ContextGroup[] {
		const wanted = (options.corpora ?? LOCAL_CORPORA).filter((c) =>
			this.corpora.has(c),
		);
		const limit = options.limit ?? 20;

		return wanted.map((name) => {
			const corpus = this.corpora.get(name) as Corpus;
			// Three-valued, not boolean: `in`, `out`, and `cannot tell`.
			//
			// A document with no project identity is NOT excluded. "No key"
			// means "unknown", and a boolean would turn that into "no" and hide
			// it. Measured: 0 of 17 memory files and 0 of 238 file changes
			// carried a key, so a boolean filter hid almost the whole corpus and
			// reported it as an empty result.
			const project = options.project;
			const scoped = project
				? (id: string) => {
						const doc = corpus.docs.get(id);
						if (!doc) return false;
						// The candidate is described by every field it has, so
						// each corpus is matched on the key it actually uses.
						return matches(project, candidateFor(doc)) !== "out";
					}
				: undefined;

			// `searched` counts the documents in SCOPE, not in the corpus, so a
			// project filter that matches nothing reports "0 of 0" rather than
			// "0 of 8,000" and reads as an empty scope instead of a failed query.
			const searched = scoped
				? [...corpus.docs.keys()].filter(scoped).length
				: corpus.docs.size;

			const { hits, total, terms } = corpus.index.search(query, {
				limit,
				filter: scoped,
			});

			// How many of the in-scope documents could not be attributed. The
			// view labels these rather than letting them pass as confirmed
			// members of the project.
			let unattributed = 0;
			if (project) {
				for (const doc of corpus.docs.values()) {
					if (matches(project, candidateFor(doc)) === "unknown") unattributed++;
				}
			}

			return {
				corpus: name,
				hits: hits
					.map((hit) => this.toHit(corpus, hit))
					.filter((hit): hit is ContextHit => hit !== null),
				total,
				searched,
				terms,
				...(project && unattributed ? { unattributed } : {}),
			};
		});
	}

	/**
	 * Attach a hit's document.
	 *
	 * Returns null when the id is not in `docs`, which can only happen if the
	 * postings and the document map disagree. That is a real inconsistency, so
	 * it drops the hit rather than emitting a row with no title -- a result the
	 * UI cannot render and the user cannot act on.
	 */
	private toHit(
		corpus: Corpus,
		hit: { docId: string; score: number; matched: string[] },
	): ContextHit | null {
		const doc = corpus.docs.get(hit.docId);
		if (!doc) return null;
		return { ...doc, score: hit.score, matched: hit.matched };
	}

	stats(): ContextFindStats["corpora"] {
		return LOCAL_CORPORA.map((name) => {
			const corpus = this.corpora.get(name) as Corpus;
			return {
				corpus: name,
				documents: corpus.docs.size,
				vocabulary: corpus.index.vocabulary,
				cap: corpus.cap,
				evicted: corpus.evicted,
			};
		});
	}
}

/**
 * Assemble the response.
 *
 * Kept as a function rather than a method so the delegated `prompt` group --
 * which this index cannot produce -- is merged in one place, in the declared
 * corpus order, instead of being appended by each caller in whatever order it
 * happened to build things.
 */
export function findResult(
	query: string,
	groups: ContextGroup[],
	projectKey?: string,
): ContextFindResult {
	return {
		query,
		scope: projectKey === undefined ? "all" : "project",
		projectKey,
		groups,
	};
}
