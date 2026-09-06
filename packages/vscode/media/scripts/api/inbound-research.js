/**
 * Inbound message handlers: research history.
 *
 * Registered via API.on rather than merged, so two files cannot silently claim
 * one message type with the last loaded winning.
 */

(() => {
	const API = window.API;

	API.on(["research-results"], function (payload) {
		const result = payload || {};
		State.update("researchView", {
			...(State.researchView || {}),
			results: result,
			// Cleared unconditionally. A search that errored must stop the
			// spinner too, or a failure is indistinguishable from a slow query --
			// the failure shape this project has shipped three times.
			searching: false,
			error: result.error || null,
		});
	});

	API.on(["research-item"], function (payload) {
		State.update("researchView", {
			...(State.researchView || {}),
			selected: payload || null,
		});
	});

	API.on(["research-stats"], function (payload) {
		State.update("researchView", {
			...(State.researchView || {}),
			stats: payload || null,
		});
	});
})();
