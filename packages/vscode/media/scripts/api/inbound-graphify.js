/**
 * Inbound message handlers: the graphify graph.
 *
 * Registered via API.on rather than merged, so two files cannot silently claim
 * one message type with the last loaded winning.
 */

(() => {
	const API = window.API;

	API.on(["graph-status"], (payload) => {
		State.update("researchView", {
			...(State.researchView || {}),
			graphStatus: payload || null,
		});
	});

	API.on(["graph-results"], (payload) => {
		const result = payload || {};
		State.update("researchView", {
			...(State.researchView || {}),
			graphResults: result,
			// Cleared unconditionally, including on failure. A query that errored
			// must stop the spinner too.
			searching: false,
			error: result.error || null,
		});
	});

	API.on(["graph-neighbors"], (payload) => {
		const result = payload || {};
		State.update("researchView", {
			...(State.researchView || {}),
			graphNeighbors: result,
			neighborsLoading: false,
			// A node with no neighbours is a real answer; an error is not.
			error: result.error || null,
		});
	});

	API.on(["graph-node"], (payload) => {
		State.update("researchView", {
			...(State.researchView || {}),
			graphSelected: payload || null,
		});
	});
})();
