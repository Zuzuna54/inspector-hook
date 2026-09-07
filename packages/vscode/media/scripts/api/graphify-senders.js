/**
 * Graphify senders (M4 — the code and docs graph).
 *
 * Pure `send()` wrappers with no shared state, composed onto API after the
 * literal exactly as the research senders are.
 *
 * Separate from research-senders.js on purpose: the research index answers
 * "what did I look up and conclude", the graph answers "what is this symbol and
 * what touches it". One search box offers both; they are not one query.
 */

const GraphifyApiMixin = {
	/** Whether a graph exists, how big it is, and whether it still matches HEAD. */
	graphStatus(params = {}) {
		this.send("graph-status", params);
	},

	graphSearch(params = {}) {
		this.send("graph-search", params);
	},

	/**
	 * What a node connects to.
	 *
	 * The question a text index cannot answer at all — "what calls this, and
	 * what breaks if I change it" is a traversal, not a match.
	 */
	graphNeighbors(params = {}) {
		this.send("graph-neighbors", params);
	},

	/** One node by id. */
	graphGet(id) {
		this.send("graph-get", { id });
	},
};

if (typeof window !== "undefined" && window.API) {
	Object.assign(window.API, GraphifyApiMixin);
}
