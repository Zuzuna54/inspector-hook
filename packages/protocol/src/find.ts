/**
 * Cross-corpus search over everything the context surfaces hold.
 *
 * Four corpora, and the shape of this module is decided by one fact: **their
 * scores are not comparable**. Each corpus has its own BM25 index, so each has
 * its own average document length and its own IDF for the same term. A memory
 * file scoring 8.1 and a file change scoring 6.4 do not stand in that order --
 * they were measured against different rulers.
 *
 * So the result is `groups`, never a single ranked list. That is not a UI
 * preference to be overridden later by someone who wants "one list": merging
 * these numbers produces an order that looks authoritative and is arbitrary.
 * If a merged list is ever genuinely wanted, it needs a rank-fusion step
 * (RRF or similar) that discards the scores rather than comparing them.
 */

/**
 * Which body of material a hit came from.
 *
 * `prompt` is delegated to the M4 `ResearchIndex` rather than re-indexed here.
 * It is listed as a corpus because that is what it is to the user; the fact
 * that a different index answers for it is an implementation detail everywhere
 * except in the scores, which is exactly why groups are kept apart.
 */
export type ContextCorpus =
	| "memory"
	| "digest"
	| "filechange"
	| "prompt"
	| "logs";

export const CONTEXT_CORPORA: ContextCorpus[] = [
	"memory",
	"digest",
	"filechange",
	"prompt",
	"logs",
];

/** Human labels, so the view does not invent its own and drift from these. */
export const CORPUS_LABELS: Record<ContextCorpus, string> = {
	memory: "Memory files",
	digest: "Session digests",
	filechange: "File changes",
	prompt: "Prompts and replies",
	logs: "Events",
};

/**
 * One indexed document.
 *
 * `text` is what gets searched and is NOT returned by a search -- only
 * `snippet` is. Bodies stay with their own stores so this index holds
 * statistics rather than a second copy of the corpus that can drift from it.
 */
export interface ContextDoc {
	id: string;
	corpus: ContextCorpus;
	title: string;
	/** The searchable body. Never leaves the core. */
	text: string;
	/** Short extract for display. */
	snippet: string;
	/** ISO 8601. Drives eviction order when a corpus is over its cap. */
	timestamp: string;
	projectKey?: string;
	projectName?: string;
	sessionId?: string;
	/** File path, for memory files and file changes. */
	path?: string;
}

export interface ContextHit {
	id: string;
	corpus: ContextCorpus;
	title: string;
	snippet: string;
	timestamp: string;
	score: number;
	/** Query terms this document actually matched, for explaining the hit. */
	matched: string[];
	projectKey?: string;
	projectName?: string;
	sessionId?: string;
	path?: string;
}

/**
 * One corpus's answer.
 *
 * `searched` is reported per group because "4 hits" means something different
 * out of 31 memory files than out of 8,000 prompts, and a group that could not
 * be searched at all says so in `unavailable` rather than returning an empty
 * list that reads as "nothing matched".
 */
export interface ContextGroup {
	corpus: ContextCorpus;
	hits: ContextHit[];
	/** How many matched before the limit was applied. */
	total: number;
	/** How many documents this corpus holds within the searched scope. */
	searched: number;
	/** Terms actually used, after stop-word removal. */
	terms: string[];
	/** Why this corpus produced nothing, when the reason is not "no match". */
	unavailable?: string;
	/**
	 * Documents in this corpus that carry no project identity at all.
	 *
	 * Reported because a project-scoped search CANNOT decide these, and the
	 * only two wrong answers are both silent: excluding them hides real
	 * material, including them without saying so overstates the scope. They are
	 * included and counted here, so the view can label them.
	 *
	 * This is not hypothetical. Measured on the live corpus: 0 of 17 memory
	 * files and 0 of 238 file changes carry a key, because memory is keyed on a
	 * project SLUG and file changes had no key at all -- while digests are
	 * keyed on the working directory and prompts on the git remote. Three
	 * identity spaces, which is why a boolean here would hide most of the data.
	 */
	unattributed?: number;
}

export interface ContextFindResult {
	query: string;
	/**
	 * Which breadth was searched. Reported rather than assumed, matching
	 * `ResearchSearchResult.scope` -- a result set never leaves its own breadth
	 * implicit.
	 */
	scope: "project" | "all";
	projectKey?: string;
	groups: ContextGroup[];
}

export interface ContextCorpusStats {
	corpus: ContextCorpus;
	documents: number;
	/**
	 * Which index answers for this corpus, when it is not this one.
	 *
	 * Set only for a delegated corpus, and the fields below are then OMITTED
	 * rather than zeroed. `ResearchIndex` exposes neither its vocabulary nor
	 * its cap, and reporting `0` for them would read as "no terms, no limit" --
	 * two specific and false claims, where an absent field reads as what it is:
	 * a number this service cannot truthfully supply.
	 */
	delegatedTo?: string;
	vocabulary?: number;
	/** The per-corpus cap. Zero means uncapped. */
	cap?: number;
	/** How many documents this corpus has evicted since the core started. */
	evicted?: number;
}

export interface ContextFindStats {
	corpora: ContextCorpusStats[];
	/**
	 * What the store is costing on disk.
	 *
	 * Retention is off by choice, so growth is unbounded and nothing else in
	 * the UI reports it. `PersistenceStore.getStats()` has computed this since
	 * it was written and had no consumer until here.
	 */
	store?: {
		totalSize: number;
		sessionCount: number;
		logCount: number;
		versionCount: number;
		archiveCount: number;
	};
}

/**
 * Per-corpus caps.
 *
 * The reason these are per corpus and not one global number is the whole
 * argument for a separate index. `ResearchIndex.trim()` evicts oldest-first
 * against a single 5,000-document cap shared by every kind it holds, so a
 * corpus that churns (prompts) evicts one that does not (memory files) --
 * silently, and in the order that loses the curated material first.
 *
 * Memory is capped highest relative to its real size: 31 files on this machine
 * against a 2,000 cap, so it is effectively uncapped and a memory file cannot
 * be pushed out by file-change churn.
 */
export const CONTEXT_CORPUS_CAPS: Record<ContextCorpus, number> = {
	memory: 2_000,
	digest: 5_000,
	filechange: 10_000,
	// Delegated to ResearchIndex, which enforces its own cap.
	prompt: 0,
	// Matches the core's in-memory log ceiling, so this corpus holds exactly
	// what the store holds rather than a shorter window of it.
	logs: 10_000,
};

/** Longest snippet stored per document. */
export const CONTEXT_SNIPPET_LENGTH = 600;

/**
 * Most changed lines indexed for one file change.
 *
 * A generated file or a wholesale rewrite would otherwise put tens of
 * thousands of lines into the postings for a single change, which both bloats
 * the index and drowns every other document's terms in the IDF.
 */
export const MAX_CHANGED_LINES = 200;

/** Byte ceiling on the text taken from any one document. */
export const MAX_DOC_TEXT_BYTES = 16 * 1024;
