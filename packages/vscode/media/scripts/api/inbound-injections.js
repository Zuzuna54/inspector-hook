/**
 * Inbound handlers for the delivery log.
 *
 * A failure arrives as an empty list, never as silence — this drives a tab in
 * the session detail, and an unanswered message leaves it on its loading state
 * forever.
 */

(() => {
	const API = window.API;

	API.on("context-injections", function (payload) {
		State.update("injectionsView", {
			...State.injectionsView,
			sessionId: payload?.sessionId ?? State.injectionsView.sessionId,
			records: Array.isArray(payload?.records) ? payload.records : [],
			unparseable: payload?.unparseable || 0,
			loading: false,
		});
	});

	API.on("context-injection-counts", function (payload) {
		State.update("injectionsView", {
			...State.injectionsView,
			counts: payload?.counts || {},
		});
	});
})();
