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

	API.on(["research-embeddings"], function (payload) {
		const r = payload || {};
		const view = State.researchView || {};
		State.update("researchView", {
			...view,
			// Coverage is folded into stats so one place describes the corpus.
			stats: view.stats
				? {
						...view.stats,
						embeddings: {
							available: Boolean(r.available),
							embedded: r.embedded ?? 0,
							error: r.error,
						},
					}
				: view.stats,
			// Keep looping while a batch is still producing work. `batch` is
			// undefined right after enabling (no batch has run) and 0 once one
			// embedded nothing -- which is what ends the loop. Reading the
			// corpus total here instead would never start on a fresh corpus.
			embedding: Boolean(r.available) && r.batch !== 0,
		});
	});

	API.on(["research-stats"], function (payload) {
		State.update("researchView", {
			...(State.researchView || {}),
			stats: payload || null,
		});
	});
})();
