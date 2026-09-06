/**
 * Inbound message handlers: File changes, diffs and the archive.
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

	API.on(["fileChanges", "file-changes"], function (payload) {

		State.update("fileChanges", payload.changes || []);
		this._updateTabBadge("changes", (payload.changes || []).length);
	});
	API.on(["fileChange"], function (payload) {
 {
		// Single file change update
		const changes = [...State.fileChanges];
		const changeIdx = changes.findIndex((c) => c.id === payload.id);

		if (payload.eventType === "kept" || payload.eventType === "reverted") {
			// Remove from pending
			if (changeIdx >= 0) {
				changes.splice(changeIdx, 1);
			}
		} else if (changeIdx >= 0) {
			// Update existing
			changes[changeIdx] = payload;
		} else {
			// Add new
			changes.unshift(payload);
		}
		State.update("fileChanges", changes);
		this._updateTabBadge("changes", changes.length);
		return;
	}
	});
	API.on(["diff-result"], function (payload) {

		// Route to whichever view asked for it. This used to go only to
		// FileChangesView, so the Archived view's "View" button requested a
		// diff that was delivered to a view which never displayed it - and
		// Archived listened on a State key ("currentDiff") that nothing ever
		// sets, so its preview could not appear by either route.
		if (
			State.currentView === "archived" &&
			window.ArchivedView?.handleDiffResult
		) {
			window.ArchivedView.handleDiffResult(payload);
		} else if (window.FileChangesView?.handleDiffResult) {
			window.FileChangesView.handleDiffResult(payload);
		}
	});
	API.on(["diff-error"], function (payload) {

		// Routed like diff-result: to the view that asked.
		if (
			State.currentView === "archived" &&
			window.ArchivedView?.handleDiffError
		) {
			window.ArchivedView.handleDiffError(payload);
		} else if (window.FileChangesView?.handleDiffError) {
			window.FileChangesView.handleDiffError(payload);
		}
	});
	API.on(["archived"], function (payload) {

		State.update("archivedChanges", payload.changes || []);
		return;
	// A restore mutates the archive and the file's version history, but
	// neither result had a handler at all, so the UI kept showing the
	// change as still archived until the panel was reopened.
	});
	API.on(["restore-archived-result"], function (payload) {

		if (payload?.success !== false) {
			this.getArchivedChanges();
			this.getTrackedFiles();
		}
	});
	API.on(["restore-result"], function (payload) {

		if (payload?.success !== false) {
			this.getTrackedFiles();
			this.getArchivedChanges();
		}
		return;
	// Raw content for one stored version. history.js has always called
	// API.getVersionContent, which did not exist - so opening a version in
	// the viewer threw "is not a function" and the request was never sent.
	});
})();
