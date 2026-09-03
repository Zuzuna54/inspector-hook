/**
 * Sessions View - Complete Redesign
 * Split-panel layout with Activity, Tools, and Logs tabs
 */

const SessionsView = {
	// Subscription cleanup functions
	_unsubscribers: [],

	// Expanded items tracking
	_expandedItems: new Set(),

	// Auto-refresh interval for active sessions (fast - every 2s)
	_refreshInterval: null,

	// Slower refresh interval for all sessions list (every 30s)
	_sessionsListRefreshInterval: null,

	// Track rendered activity items to avoid full re-renders
	_renderedActivityIds: new Set(),

	_lastActivityCount: 0,

	// Copy-button payloads, keyed by a short generated id.
	// The text itself must never go into an HTML attribute: Utils.escapeHtml
	// escapes via textContent, which does NOT escape quotes, and tool input is
	// JSON that always contains them - the attribute would end at the first
	// quote and the rest would be parsed as stray attributes.
	_copyPayloads: new Map(),

	_copyKeySeq: 0,

	// Turn grouping: which turns the user has collapsed, the turn keys currently
	// rendered (to detect a new turn, which changes structure rather than just
	// contents), and the session the default collapse was seeded for.
	_collapsedTurns: new Set(),

	_renderedTurnKeys: [],

	_turnsSeededFor: null,

	/**
	 * Initialize the sessions view
	 */
	init() {
		this.setupSearch();
		this.render();

		// Subscribe to state changes
		this._unsubscribers.push(
			State.subscribe("sessions", () => this.renderSidebar()),
		);
		this._unsubscribers.push(
			State.subscribe("sessionView", (newVal, oldVal) => {
				// Only re-render detail if session or tab changed
				if (
					newVal.selectedSession !== oldVal?.selectedSession ||
					newVal.activeTab !== oldVal?.activeTab
				) {
					// Clear rendered items cache when switching sessions/tabs
					this._renderedActivityIds.clear();
					this._lastActivityCount = 0;
					this.renderDetail();
				}
				// Incrementally update activity when data changes (don't full re-render)
				else if (newVal.sessionActivity !== oldVal?.sessionActivity) {
					if (newVal.activeTab === "activity") {
						this.updateActivityFeed();
					}
				}
				// Full re-render for logs tab
				else if (newVal.sessionLogs !== oldVal?.sessionLogs) {
					if (newVal.activeTab === "logs") {
						this.renderTabContent();
					}
				}
			}),
		);

		// Request fresh sessions
		API.getSessions();

		// Start auto-refresh for active sessions
		this.startAutoRefresh();
	},

	/**
	 * Clean up subscriptions and intervals
	 */
	cleanup() {
		this._unsubscribers.forEach((unsub) => unsub());
		this._unsubscribers = [];
		this.stopAutoRefresh();
	},

	/**
	 * Start auto-refresh for active sessions
	 */
	startAutoRefresh() {
		this.stopAutoRefresh();

		// Poll the selected session's activity. Only one request per tick: the
		// activity response already carries the session, so the get-session call
		// that used to sit here was fetching the same data a second time - and
		// the full session includes every tool input and result, which reached
		// 4.7 MB on a long run.
		this._activityTick = 0;
		this._refreshInterval = setInterval(() => {
			this._activityTick++;
			if (!this.isVisible()) return;

			const selectedSession = this.getSelectedSession();
			if (!selectedSession) return;

			// Idle sessions can become active again, so keep watching them - but
			// at a slower cadence. Finished sessions cannot change; stop entirely.
			const status = selectedSession.status;
			if (status !== "active" && status !== "idle") return;
			if (status === "idle" && this._activityTick % 5 !== 0) return;

			// Incremental after the first fetch: only what changed since the last
			// response, which is the difference between a few hundred bytes and
			// the whole window every two seconds.
			API.getSessionActivity(selectedSession.id, {
				since: State.sessionView.activitySince || undefined,
			});
		}, 2000);

		// Slower refresh for all sessions list (every 30s)
		// This ensures sidebar shows up-to-date status for all sessions
		this._sessionsListRefreshInterval = setInterval(() => {
			if (!this.isVisible()) return;
			API.getSessions();
		}, 30000);
	},

	/**
	 * Is the Sessions tab actually on screen? Polling a hidden panel costs the
	 * same bytes as polling a visible one and shows the user nothing.
	 * @returns {boolean}
	 */
	isVisible() {
		return (
			State.currentView === "sessions" &&
			document.visibilityState !== "hidden"
		);
	},

	/**
	 * Stop auto-refresh
	 */
	stopAutoRefresh() {
		if (this._refreshInterval) {
			clearInterval(this._refreshInterval);
			this._refreshInterval = null;
		}
		if (this._sessionsListRefreshInterval) {
			clearInterval(this._sessionsListRefreshInterval);
			this._sessionsListRefreshInterval = null;
		}
	},

	/**
	 * Render the complete sessions view
	 */
	render() {
		this.renderSidebar();
		this.renderDetail();
	},
};

/*
 * Compose the extracted modules onto the view. Object.assign keeps every
 * method a plain member of one object, so `this` inside them resolves to
 * SessionsView exactly as it did when they were declared inline.
 *
 * Read through window.* rather than the bare const each module declares: the
 * bindings would resolve across classic script tags, but going through the
 * explicit global states the dependency and works under any loader. panel.ts
 * loads all six before this file.
 */
Object.assign(
	SessionsView,
	window.SessionUtils,
	window.SessionListMixin,
	window.ActivityItemsMixin,
	window.ActivityFeedMixin,
	window.ToolDetailMixin,
	window.SessionDetailMixin,
);

// Register view with router
Router.register("sessions", SessionsView);

// Make globally available
window.SessionsView = SessionsView;
