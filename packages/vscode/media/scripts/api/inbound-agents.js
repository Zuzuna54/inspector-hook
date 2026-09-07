/**
 * Inbound message handlers: the agent tree.
 *
 * Registered via API.on rather than merged, so two files cannot silently claim
 * one message type with the last loaded winning.
 */

(() => {
	const API = window.API;

	API.on(["agents-tree"], (payload) => {
		const result = payload || {};
		State.update("agentsView", {
			...(State.agentsView || {}),
			agents: result.agents || [],
			stats: result.stats || null,
			// Cleared unconditionally, including on failure: a tree that failed
			// to load must stop the spinner, not look like "no agents ran".
			loading: false,
			error: result.error || null,
		});
	});

	API.on(["agents-stats"], (payload) => {
		State.update("agentsView", {
			...(State.agentsView || {}),
			stats: payload || null,
		});
	});

	API.on(["agent-detail"], (payload) => {
		State.update("agentsView", {
			...(State.agentsView || {}),
			selected: payload || null,
		});
	});
})();
