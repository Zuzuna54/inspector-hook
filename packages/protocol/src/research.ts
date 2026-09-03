/**
 * Research history (Milestone 4).
 *
 * The searchable record of what was looked up, asked, delegated and concluded —
 * as opposed to native auto memory, which holds a small set of curated facts.
 * The research corpus is far too large to preload into a session and belongs
 * behind a query instead.
 *
 * ## Why this exists as its own store rather than as a view over logs
 *
 * Retention deletes raw events. The plan pairs that with "collapse to session
 * summaries + the index and drop raw rows", so the index has to be a durable
 * artefact in its own right: built as events arrive, persisted separately, and
 * outliving the logs it came from. A search that only worked inside the
 * retention window would answer "where did I solve this before" with silence
 * precisely when the question is worth asking.
 */

/** What kind of research an item records. */
export type ResearchKind =
	| "web_search"
	| "web_fetch"
	| "subagent_task"
	| "subagent_report"
	| "user_prompt"
	| "conclusion";

/**
 * One indexed unit of research history.
 *
 * `text` is what gets searched; every other field is for filtering and for
 * showing the result. Content arrives already redacted — redaction runs on
 * ingest, before anything is stored — so the index never holds a secret the
 * log did not.
 */
export interface ResearchItem {
	/** Stable id, derived from the log entry this came from. */
	id: string;
	kind: ResearchKind;
	/** ISO 8601. */
	timestamp: string;
	/** The session it happened in. May no longer exist; see SessionSummaryRecord. */
	sessionId?: string;
	/**
	 * Which project this belongs to.
	 *
	 * Git remote when there is one, else the working directory. Both are
	 * captured on every hook event, so this needs no inference.
	 */
	projectKey?: string;
	/** Human-facing project name, for display. */
	projectName?: string;
	/** Short headline — a query, a URL, a task description. */
	title: string;
	/** The searchable body. */
	text: string;
	/** Source URL, for web items. */
	url?: string;
	/** Subagent type, for delegated work. */
	agentType?: string;
	/** Groups items belonging to one user turn. */
	promptId?: string;
}

/** One hit. */
export interface ResearchHit {
	item: ResearchItem;
	/** BM25 score. Comparable within one result set, not across queries. */
	score: number;
	/** Query terms that matched, for highlighting and for explaining the hit. */
	matched: string[];
}

export interface ResearchSearchResult {
	hits: ResearchHit[];
	/** How many items matched before the limit was applied. */
	total: number;
	/** How many items the index holds in the searched scope. */
	searched: number;
	/** Terms actually used, after stop-word removal — empty means no query. */
	terms: string[];
}

/** Index size and composition, for the UI and for capacity questions. */
export interface ResearchIndexStats {
	items: number;
	/** Distinct terms in the vocabulary. */
	terms: number;
	/** Item counts by kind. */
	byKind: Record<string, number>;
	/** Item counts by project. */
	byProject: Record<string, number>;
	/** Oldest and newest item timestamps, ISO 8601. */
	oldest?: string;
	newest?: string;
}
