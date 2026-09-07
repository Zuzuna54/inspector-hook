/**
 * Research history senders (M4 — searchable research history).
 *
 * Pure `send()` wrappers with no shared state, composed onto API after the
 * literal exactly as the memory senders are.
 *
 * The core has indexed research since M4 landed and nothing in the webview
 * referenced it — 569 items in the live store, reachable only by a raw
 * JSON-RPC call. These are the first callers.
 */

const ResearchApiMixin = {
	// ==========================================================================
	// Research API (M4 - research history search)
	// ==========================================================================

	/**
	 * Search the research corpus.
	 *
	 * Omitting `projectKey` searches EVERY project on the machine, which is the
	 * point of a machine-wide core and the thing per-project native memory
	 * cannot do. The reply always states which scope it used.
	 */
	researchSearch(params = {}) {
		this.send("research-search", params);
	},

	/** One item by id — its log entry may have been deleted by retention. */
	researchGet(id) {
		this.send("research-get", { id });
	},

	/** Corpus size and composition, including the project to default to. */
	researchStats() {
		this.send("research-stats", {});
	},

	/**
	 * Turn on semantic retrieval.
	 *
	 * Explicit rather than automatic: loading the model takes seconds and
	 * embedding a real corpus takes tens of seconds, which is not something to
	 * spend on every core start for a view the user may never open.
	 */
	researchEnableEmbeddings() {
		this.send("research-enable-embeddings", {});
	},

	/** Embed one bounded batch. The caller loops until `embedded` is 0. */
	researchEmbedPending(limit = 200) {
		this.send("research-embed-pending", { limit });
	},
};

if (typeof window !== "undefined" && window.API) {
	Object.assign(window.API, ResearchApiMixin);
}
