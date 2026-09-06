/**
 * Inbound message handlers: Version history.
 *
 * Registered rather than merged. Message types are DATA, and a mixin merge
 * would let two files silently claim one type with the last loaded winning --
 * a class of bug this codebase has already paid for twice. `API.on` throws on
 * a duplicate instead.
 *
 * Each handler is called with `API` as `this`, so `this.send` and the badge
 * helpers work exactly as they did inside the switch.
 */

(() => {
	const API = window.API;

	API.on(["tracked-files"], function (payload) {

		// Store tracked files list in state
		State.update("trackedFiles", payload.files || []);
		// Notify history view
		if (window.HistoryView?.handleTrackedFiles) {
			window.HistoryView.handleTrackedFiles(payload);
		}
	});
	API.on(["version-history"], function (payload) {

		// Handle null payload or missing fields
		if (payload && payload.filePath) {
			State.update("versionHistory", {
				...State.versionHistory,
				[payload.filePath]: payload.versions || [],
			});
			// Also notify history view
			if (window.HistoryView?.handleVersionHistory) {
				window.HistoryView.handleVersionHistory(payload);
			}
		}
	});
	API.on(["version-comparison"], function (payload) {

		// Version comparison result - handled by history view
		if (window.HistoryView?.handleVersionComparison) {
			window.HistoryView.handleVersionComparison(payload);
		}
		return;
	// A deleted session produces no push event from the core - unlike a
	// kept or reverted change, which arrives as "fileChange" - so without
	// this the sidebar keeps showing the session until the 30s list poll.
	});
	API.on(["delete-version-result"], function (payload) {

		if (payload?.success !== false) this.getTrackedFiles();
		return;
	// One case for stage/get/clear: each ends with "here is what is staged,
	// or nothing", so the view re-renders from whatever came back.
	//
	// A REFUSAL also comes back here, as `{staged:false, reason}`. That
	// object is truthy, so assigning it straight to `staged` drew the
	// "Staged for the next session" box over an empty body and an
	// invalid expiry -- a failure rendered as a success, with the reason
	// discarded. Branch on the explicit flag, and keep the reason.
	});
	API.on(["version-content"], function (payload) {

		if (window.HistoryView?.handleVersionContent) {
			window.HistoryView.handleVersionContent(payload);
		}
	});
})();
