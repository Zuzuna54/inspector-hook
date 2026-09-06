/**
 * Inbound handlers for the transcript (P5).
 *
 * A session with no transcript path comes back with `reason` and no entries.
 * That is a real and common state — 27 of 33 memory files cite an origin
 * session and none of those sessions still exist — so it is stored as a reason
 * to render, not discarded into an empty view that looks like a loading state.
 */

(() => {
	const API = window.API;

	API.on("transcript-stats", function (payload) {
		State.update("transcriptView", {
			...State.transcriptView,
			stats: payload && !payload.reason ? payload : null,
			reason: payload?.reason || null,
		});
	});

	API.on("transcript-page", function (payload) {
		State.update("transcriptView", {
			...State.transcriptView,
			entries: payload?.entries || [],
			total: payload?.total || 0,
			hasMore: Boolean(payload?.hasMore),
			stats: payload?.stats || State.transcriptView.stats,
			reason: payload?.reason || null,
		});
	});
})();
