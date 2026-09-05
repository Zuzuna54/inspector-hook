/**
 * Inbound message handlers: Connection, init and the top-level counters.
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

	API.on(["ping"], function (payload) {

		// Respond to ping from extension
		this.send("pong", {
			received: payload?.timestamp,
			responded: Date.now(),
		});
	});
	API.on(["init"], function (payload) {

		// Initial data load
		State.batchUpdate({
			connected: true,
			stats: payload.stats || State.stats,
			logs: payload.logs || [],
			sessions: payload.sessions || [],
			fileChanges: payload.fileChanges || [],
		});
		if (payload.config) {
			State.update("config", { ...State.config, ...payload.config });
		}
		// Update tab badges with initial counts
		this._updateTabBadge("logs", (payload.logs || []).length);
		this._updateTabBadge("changes", (payload.fileChanges || []).length);
	});
	API.on(["stats"], function (payload) {

		State.update("stats", payload);
	});
	API.on(["log"], function (payload) {
 {
		// Single new log entry
		const logs = [payload, ...State.logs].slice(0, State.config.maxLogs);
		State.update("logs", logs);
		// Update tab badge
		this._updateTabBadge("logs", logs.length);
		return;
	}

	// The core's liveness, which the header used to assert rather than
	// know: the markup shipped with class "connected" and the literal
	// text "Connected", and nothing anywhere read either element.
	});
	API.on(["core-status"], function (payload) {

		State.update("connected", payload?.connected !== false);
		State.update("connectionReason", payload?.reason || null);
	});
	API.on(["error"], function (payload) {

		// Handle error messages from extension
		// Could show a toast/notification here
	});
})();
