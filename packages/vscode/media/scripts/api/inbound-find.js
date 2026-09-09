/**
 * Inbound handlers for the four-corpus search.
 *
 * The core answers EVERY failure with the full set of groups, each carrying
 * `unavailable`. So there is one rendering path — draw the groups — and no
 * separate error path that only appears when something is broken, which is the
 * path least likely to have been looked at.
 */

(() => {
	const API = window.API;

	API.on("context-find-results", function (payload) {
		// `searching` is cleared unconditionally. Clearing it only on success
		// leaves the view spinning forever on the one case that most needs to
		// be visible.
		State.update("contextFind", {
			...State.contextFind,
			query: payload?.query ?? State.contextFind.query,
			groups: Array.isArray(payload?.groups) ? payload.groups : [],
			searching: false,
		});
	});

	API.on("context-find-stats", function (payload) {
		State.update("contextFind", {
			...State.contextFind,
			stats: payload || null,
		});
	});
})();
