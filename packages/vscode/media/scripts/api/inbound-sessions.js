/**
 * Inbound message handlers: Logs and sessions.
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

	API.on(["logs"], function (payload) {
 {
		// `total` is what the core holds; `logs` is the page we asked for.
		// Badging the page length made the tab report the request limit
		// rather than reality -- 100, next to a Dashboard reading 7,773
		// for the same quantity.
		const rows = payload.logs || [];
		State.update("logs", rows);
		State.update(
			"logsTotal",
			typeof payload.total === "number" ? payload.total : rows.length,
		);
		this._updateTabBadge("logs", State.logsTotal);
		return;
	}
	});
	API.on(["sessions"], function (payload) {

		State.update("sessions", payload.sessions || []);
	});
	API.on(["session"], function (payload) {
 {
		// Single session update
		const sessions = [...State.sessions];
		const sessionIdx = sessions.findIndex((s) => s.id === payload.id);
		if (sessionIdx >= 0) {
			sessions[sessionIdx] = payload;
		} else {
			sessions.unshift(payload);
		}
		State.update("sessions", sessions);
		return;
	}
	});
	API.on(["session-logs"], function (payload) {

		// Session logs response
		State.update("sessionView", {
			...State.sessionView,
			sessionLogs: payload?.logs || [],
		});
	});
	API.on(["session-activity"], function (payload) {
 {
		// Session activity feed response. The payload also carries the
		// session itself, so the poller does not need a separate
		// get-session round trip - that call returned the full session
		// (tool inputs and results included, megabytes on a long run)
		// for data already present here.
		const incomingActivity = payload?.activity || [];

		// Merge by id rather than replace. An incremental response carries
		// only what changed, and deliberately re-sends the boundary items,
		// so replacing would drop everything older on the first delta. An
		// id already present is an UPDATE - a tool call completing is the
		// common case - so the incoming version wins.
		const isDelta = typeof payload?.since === "string" && payload.since !== "";
		const merged = isDelta
			? mergeActivity(State.sessionView.sessionActivity, incomingActivity)
			: incomingActivity;

		// Prefer the slim summary; fall back to the full session while the
		// core still sends one. The summary deliberately omits
		// toolExecutions (it dominated the payload), so MERGE rather than
		// replace - overwriting would strip the array the Tools tab renders.
		const incoming = payload?.sessionSummary || payload?.session;
		if (incoming?.id) {
			const sessions = [...State.sessions];
			const idx = sessions.findIndex((s) => s.id === incoming.id);
			if (idx >= 0) {
				sessions[idx] = { ...sessions[idx], ...incoming };
			} else {
				sessions.unshift(incoming);
			}
			State.update("sessions", sessions);
		}
		State.update("sessionView", {
			...State.sessionView,
			sessionActivity: merged,
			// Passed back as `since` next poll. Absent means the server had
			// nothing newer, so the existing cursor stands.
			activitySince:
				typeof payload?.nextSince === "string"
					? payload.nextSince
					: State.sessionView.activitySince,
			activityHasMore: payload?.hasMore === true,
			// The feed window is capped server-side. Without these the UI
			// would imply the session simply started at the oldest item it
			// received.
			activityTruncated: payload?.truncated === true,
			// `availableLogs` is what the core RETAINS for this session, not a
			// lifetime total - reads are served from memory. Renders as
			// "of N available" for that reason. `totalLogs` is the older name.
			activityAvailableLogs:
				typeof payload?.availableLogs === "number"
					? payload.availableLogs
					: typeof payload?.totalLogs === "number"
						? payload.totalLogs
						: null,
		});
		return;
	}
	});
	API.on(["delete-session-result"], function (payload) {

		if (payload?.success !== false) this.getSessions();
		return;
	// Same gap for versions: the core emits version:created and
	// version:restored but nothing for a delete, so History would keep
	// listing a version that is gone.
	});
})();
