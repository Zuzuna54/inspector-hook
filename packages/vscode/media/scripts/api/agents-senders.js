/**
 * Agent tree senders (M5).
 *
 * Composed onto API after the literal, exactly as the research and graphify
 * senders are.
 */

const AgentsApiMixin = {
	/** The tree plus its stats, in one reply so the numbers match the rows. */
	agentsTree(params = {}) {
		this.send("agents-tree", params);
	},

	/** One agent, by our id or the platform's agentId. */
	agentsGet(id) {
		this.send("agents-get", { id });
	},

	agentsStats() {
		this.send("agents-stats", {});
	},
};

if (typeof window !== "undefined" && window.API) {
	Object.assign(window.API, AgentsApiMixin);
}
