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
	 * Stash text for a copy button and return the key to reference it by
	 * @param {string} text
	 * @returns {string} key for data-copy-key
	 */
	registerCopyPayload(text) {
		const key = `c${++this._copyKeySeq}`;
		this._copyPayloads.set(key, text);
		return key;
	},

	/**
	 * Get a human-readable display name for a session
	 * Returns an object with projectName and shortId
	 * @param {Object} session
	 * @returns {{ projectName: string, shortId: string, fullDisplay: string }}
	 */
	getSessionDisplayInfo(session) {
		let projectName = "";

		// 1. Try session.name (new field - populated by backend)
		if (session.name) {
			projectName = session.name;
		}
		// 2. Try project name from metadata, or flattened onto a summary
		else if (session.metadata?.projectName || session.projectName) {
			projectName = session.metadata?.projectName || session.projectName;
		}
		// 3. Try to extract folder name from working directory
		else if (session.metadata?.workingDirectory) {
			const path = session.metadata.workingDirectory;
			// Get last non-empty segment of path
			const segments = path.split(/[/\\]/).filter((s) => s);
			if (segments.length > 0) {
				projectName = segments[segments.length - 1];
			}
		}

		// Short session ID (first 8 chars)
		const shortId = session.id.slice(0, 8);

		// Full display combines both
		const fullDisplay = projectName ? `${projectName} • ${shortId}` : shortId;

		return { projectName, shortId, fullDisplay };
	},

	/**
	 * Get a human-readable display name for a session (legacy, for compatibility)
	 * Priority: metadata.projectName > folder from workingDirectory > truncated ID
	 * Optionally includes git branch: "projectName (branch)"
	 * @param {Object} session
	 * @param {boolean} includeBranch - whether to include git branch if available
	 * @returns {string}
	 */
	getSessionDisplayName(session, includeBranch = false) {
		const info = this.getSessionDisplayInfo(session);

		// Optionally include git branch
		const branch = this.gitBranchOf(session);
		if (includeBranch && branch) {
			return `${info.fullDisplay} (${branch})`;
		}

		return info.fullDisplay;
	},

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
	 * Setup search input handler
	 */
	setupSearch() {
		const searchInput = document.getElementById("sv-search");
		if (searchInput) {
			searchInput.addEventListener(
				"input",
				Utils.debounce((e) => {
					const query = e.target.value.trim().toLowerCase();
					State.update("sessionView", {
						...State.sessionView,
						searchQuery: query,
					});
					this.renderSidebar();
				}, 200),
			);
		}
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

			API.getSessionActivity(selectedSession.id);
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

	/**
	 * Get sessions filtered and sorted
	 * @returns {Array} Sorted and filtered sessions
	 */
	getFilteredSessions() {
		const { sessions } = State;
		const { searchQuery } = State.sessionView;

		// Filter by search query (searches display name AND project/directory metadata)
		let filtered = sessions;
		if (searchQuery) {
			filtered = sessions.filter((session) => {
				const displayName = this.getSessionDisplayName(session).toLowerCase();
				const projectName = (session.metadata?.projectName || "").toLowerCase();
				const workingDir = (
					session.metadata?.workingDirectory || ""
				).toLowerCase();
				const sessionId = session.id.toLowerCase();
				return (
					displayName.includes(searchQuery) ||
					projectName.includes(searchQuery) ||
					workingDir.includes(searchQuery) ||
					sessionId.includes(searchQuery)
				);
			});
		}

		// Sort: active/idle first, then by startTime descending
		return [...filtered].sort((a, b) => {
			// Active sessions first
			if (a.status === "active" && b.status !== "active") return -1;
			if (b.status === "active" && a.status !== "active") return 1;

			// Idle sessions second (before completed/terminated)
			if (a.status === "idle" && b.status !== "idle" && b.status !== "active")
				return -1;
			if (b.status === "idle" && a.status !== "idle" && a.status !== "active")
				return 1;

			// Then by start time (newest first)
			const timeA = new Date(a.startTime || 0).getTime();
			const timeB = new Date(b.startTime || 0).getTime();
			return timeB - timeA;
		});
	},

	/**
	 * Get the currently selected session object
	 * @returns {Object|null}
	 */
	getSelectedSession() {
		const { selectedSession } = State.sessionView;
		if (!selectedSession) return null;
		return State.sessions.find((s) => s.id === selectedSession) || null;
	},

	/**
	 * Count errors in a session
	 * @param {Object} session
	 * @returns {number}
	 */
	countErrors(session) {
		if (typeof session.errorCount === "number") return session.errorCount;
		if (!session.toolExecutions) return 0;
		return session.toolExecutions.filter(
			(t) => t.status === "error" || t.status === "failed",
		).length;
	},

	/*
	 * A session reaches this view in two shapes: the full Session from
	 * sessions.getAll, and the SessionSummary the activity response carries.
	 * The summary omits toolExecutions - which is the whole point, it dominated
	 * the payload - and pre-counts instead. These read either shape so the list
	 * and header do not care which one they were handed.
	 */

	/** @param {Object} s @returns {number} */
	toolCount(s) {
		if (typeof s.toolExecutionCount === "number") return s.toolExecutionCount;
		return s.toolExecutions?.length || 0;
	},

	/** @param {Object} s @returns {number} */
	fileCount(s) {
		if (typeof s.fileChangeCount === "number") return s.fileChangeCount;
		return s.fileChanges?.length || 0;
	},

	/** @param {Object} s @returns {string|undefined} */
	gitBranchOf(s) {
		return s.metadata?.gitBranch || s.gitBranch || undefined;
	},

	/**
	 * Render the sessions sidebar
	 */
	renderSidebar() {
		const listContainer = document.getElementById("sv-session-list");
		const countEl = document.getElementById("sv-session-count");
		if (!listContainer) return;

		const sessions = this.getFilteredSessions();
		const { selectedSession } = State.sessionView;

		// Update count
		if (countEl) {
			countEl.textContent = `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;
		}

		if (sessions.length === 0) {
			listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No sessions yet</div>
          <div class="empty-state-description">Sessions will appear here when Claude Code is active</div>
        </div>
      `;
			return;
		}

		listContainer.innerHTML = sessions
			.map((session) => {
				const isSelected = session.id === selectedSession;
				const toolCount = this.toolCount(session);
				const fileCount = this.fileCount(session);
				const errorCount = this.countErrors(session);
				const statusClass = session.status || "unknown";
				const hasErrors = errorCount > 0;
				const displayInfo = this.getSessionDisplayInfo(session);
				const gitBranch = this.gitBranchOf(session);

				return `
        <div class="sv-card ${statusClass} ${isSelected ? "selected" : ""} ${hasErrors ? "has-errors" : ""}"
             data-session-id="${session.id}">
          <div class="sv-card-header">
            <span class="sv-status-dot ${statusClass}"></span>
            <div class="sv-card-name-wrapper">
              <span class="sv-card-name" title="${Utils.escapeHtml(session.id)}">${Utils.escapeHtml(displayInfo.projectName || "Unknown Project")}</span>
              ${gitBranch ? `<span class="sv-card-branch" title="Git branch: ${Utils.escapeHtml(gitBranch)}">⎇ ${Utils.escapeHtml(gitBranch)}</span>` : ""}
            </div>
            <button class="sv-delete-btn" data-session-id="${session.id}" title="Delete session">
              &times;
            </button>
          </div>
          <div class="sv-card-meta">
            <span class="sv-card-time">${Utils.formatTime(session.startTime)}</span>
            <span class="sv-card-duration">${Utils.formatDuration(session.startTime, session.endTime)}</span>
          </div>
          <div class="sv-card-stats">
            <span class="sv-stat"><strong>${toolCount}</strong> tools</span>
            <span class="sv-stat"><strong>${fileCount}</strong> files</span>
            ${hasErrors ? `<span class="sv-stat error"><strong>${errorCount}</strong> errors</span>` : ""}
          </div>
        </div>
      `;
			})
			.join("");

		// Add click handlers for session cards
		listContainer.querySelectorAll(".sv-card").forEach((card) => {
			card.addEventListener("click", (e) => {
				if (e.target.closest(".sv-delete-btn")) return;
				const sessionId = card.dataset.sessionId;
				this.selectSession(sessionId);
			});
		});

		// Add click handlers for delete buttons
		listContainer.querySelectorAll(".sv-delete-btn").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const sessionId = btn.dataset.sessionId;
				this.confirmDeleteSession(sessionId);
			});
		});
	},

	/**
	 * Render the detail panel
	 */
	renderDetail() {
		const headerEl = document.getElementById("sv-detail-header");
		const tabsEl = document.getElementById("sv-tabs");
		const contentEl = document.getElementById("sv-detail-content");
		if (!headerEl || !tabsEl || !contentEl) return;

		const session = this.getSelectedSession();
		const { activeTab } = State.sessionView;

		if (!session) {
			headerEl.innerHTML = `
        <div class="sv-detail-empty">
          <div class="empty-state">
            <div class="empty-state-title">Select a session</div>
            <div class="empty-state-description">Click a session to view details</div>
          </div>
        </div>
      `;
			tabsEl.innerHTML = "";
			contentEl.innerHTML = "";
			return;
		}

		// Render header
		const toolCount = this.toolCount(session);
		const fileCount = this.fileCount(session);
		const errorCount = this.countErrors(session);
		const displayName = this.getSessionDisplayName(session);
		const gitBranch = this.gitBranchOf(session);

		headerEl.innerHTML = `
      <div class="sv-detail-title">
        <span class="sv-status-dot ${session.status || "unknown"}"></span>
        <h3 title="${Utils.escapeHtml(session.id)}">${Utils.escapeHtml(displayName)}</h3>
        ${gitBranch ? `<span class="sv-git-branch" title="Git branch">${Utils.escapeHtml(gitBranch)}</span>` : ""}
        <span class="sv-detail-status ${session.status || "unknown"}">${session.status || "unknown"}</span>
      </div>
      <div class="sv-quick-stats">
        <span class="sv-quick-stat">
          <span class="sv-quick-stat-icon">&#128295;</span>
          <span class="sv-quick-stat-value">${toolCount}</span>
          <span class="sv-quick-stat-label">tools</span>
        </span>
        <span class="sv-quick-stat">
          <span class="sv-quick-stat-icon">&#128196;</span>
          <span class="sv-quick-stat-value">${fileCount}</span>
          <span class="sv-quick-stat-label">files</span>
        </span>
        ${
					errorCount > 0
						? `
          <span class="sv-quick-stat error">
            <span class="sv-quick-stat-icon">&#9888;</span>
            <span class="sv-quick-stat-value">${errorCount}</span>
            <span class="sv-quick-stat-label">errors</span>
          </span>
        `
						: ""
				}
        <span class="sv-quick-stat">
          <span class="sv-quick-stat-icon">&#128337;</span>
          <span class="sv-quick-stat-value">${Utils.formatDuration(session.startTime, session.endTime)}</span>
        </span>
      </div>
    `;

		// Render tabs
		tabsEl.innerHTML = `
      <button class="sv-tab ${activeTab === "activity" ? "active" : ""}" data-tab="activity">
        Activity
      </button>
      <button class="sv-tab ${activeTab === "tools" ? "active" : ""}" data-tab="tools">
        Tools
        <span class="sv-tab-badge">${toolCount}</span>
      </button>
      <button class="sv-tab ${activeTab === "logs" ? "active" : ""}" data-tab="logs">
        Logs
      </button>
      <div class="sv-tab-actions">
        <label class="sv-auto-scroll">
          <input type="checkbox" id="sv-auto-scroll-toggle" ${State.sessionView.autoScroll ? "checked" : ""}>
          Auto-scroll
        </label>
      </div>
    `;

		// Add tab click handlers
		tabsEl.querySelectorAll(".sv-tab").forEach((tab) => {
			tab.addEventListener("click", () => {
				const tabName = tab.dataset.tab;
				this.switchTab(tabName);
			});
		});

		// Add auto-scroll toggle handler
		const autoScrollToggle = document.getElementById("sv-auto-scroll-toggle");
		if (autoScrollToggle) {
			autoScrollToggle.addEventListener("change", (e) => {
				State.update("sessionView", {
					...State.sessionView,
					autoScroll: e.target.checked,
				});
			});
		}

		// Render tab content
		this.renderTabContent();
	},

	/**
	 * Render the current tab content
	 */
	renderTabContent() {
		const contentEl = document.getElementById("sv-detail-content");
		if (!contentEl) return;

		const session = this.getSelectedSession();
		if (!session) return;

		const { activeTab } = State.sessionView;

		// Install the delegated click handler for whichever tab renders below.
		// Idempotent, so calling it per render costs nothing after the first.
		this.setupActivityHandlers();

		switch (activeTab) {
			case "activity":
				this.renderActivityTab(contentEl, session);
				break;
			case "tools":
				this.renderToolsTab(contentEl, session);
				break;
			case "logs":
				this.renderLogsTab(contentEl, session);
				break;
		}

		// Auto-scroll to bottom if enabled
		if (State.sessionView.autoScroll) {
			contentEl.scrollTop = contentEl.scrollHeight;
		}
	},

	/**
	 * Render the Activity tab
	 * @param {HTMLElement} container
	 * @param {Object} session
	 */
	renderActivityTab(container, session) {
		// Build activity feed from tool executions and logs
		const activities = this.buildActivityFeed(session);

		if (activities.length === 0) {
			container.innerHTML = `
        <div class="sv-activity-empty">
          <div class="empty-state">
            <div class="empty-state-title">No activity yet</div>
            <div class="empty-state-description">Activity will appear here as the session progresses</div>
          </div>
        </div>
      `;
			this._renderedActivityIds.clear();
			this._lastActivityCount = 0;
			return;
		}

		// Track rendered items for incremental updates using activity.id
		this._renderedActivityIds.clear();
		activities.forEach((activity) => {
			this._renderedActivityIds.add(activity.id);
		});
		this._lastActivityCount = activities.length;

		// Full rebuild: the previous payloads are unreachable once the DOM is
		// replaced, so drop them rather than letting the map grow per render.
		this._copyPayloads.clear();

		// Group into user turns. A single-turn session gains nothing from the
		// wrapper, so render it flat and skip the chrome.
		const turns = this.groupIntoTurns(activities);
		this._renderedTurnKeys = turns.map((t) => t.key);

		let body;
		if (turns.length <= 1) {
			body = activities
				.map((activity, idx) => this.renderActivityItem(activity, idx))
				.join("");
		} else {
			this.seedTurnCollapse(turns, session.id);
			let offset = 0;
			body = turns
				.map((turn) => {
					const html = this.renderTurn(turn, offset);
					offset += turn.items.length;
					return html;
				})
				.join("");
		}

		container.innerHTML = `
      <div class="sv-activity-feed">
        ${this.renderTruncationNotice(activities.length)}
        ${body}
      </div>
    `;
	},

	/**
	 * Incrementally update activity feed without full re-render
	 * Only appends new items and updates changed items
	 */
	updateActivityFeed() {
		const contentEl = document.getElementById("sv-detail-content");
		if (!contentEl) return;

		const session = this.getSelectedSession();
		if (!session) return;

		const feedEl = contentEl.querySelector(".sv-activity-feed");
		if (!feedEl) {
			// No feed exists yet, do full render
			this.renderActivityTab(contentEl, session);
			return;
		}

		const activities = this.buildActivityFeed(session);

		// If we have fewer items than before, something changed - do full render
		if (activities.length < this._lastActivityCount) {
			this.renderActivityTab(contentEl, session);
			return;
		}

		// Find new items (items we haven't rendered yet)
		const newActivities = activities.filter((activity) => {
			return !this._renderedActivityIds.has(activity.id);
		});

		if (newActivities.length === 0) {
			// No new items, maybe update running tool statuses
			this.updateRunningTools(feedEl, activities);
			return;
		}

		// A new turn changes the structure, not just the contents, so it needs a
		// full render. Appending within the current turn stays incremental, which
		// is the common case - a turn opens once per user message but accumulates
		// tool calls continuously.
		const turns = this.groupIntoTurns(activities);
		const grouped = turns.length > 1;
		if (grouped) {
			const keys = turns.map((t) => t.key);
			const known = this._renderedTurnKeys || [];
			const structureChanged =
				keys.length !== known.length ||
				keys.some((key, i) => key !== known[i]);
			if (structureChanged) {
				this.renderActivityTab(contentEl, session);
				return;
			}
		}

		if (grouped) {
			// Re-render just the open turn. It already contains the new items and
			// its header counts have changed, so replacing it in one step beats
			// appending and then patching the header. Bounded by one turn's size,
			// not the whole feed.
			const lastTurn = turns[turns.length - 1];
			const turnEl = feedEl.querySelector(".sv-turn:last-child");
			if (!turnEl) {
				this.renderActivityTab(contentEl, session);
				return;
			}
			const tempDiv = document.createElement("div");
			tempDiv.innerHTML = this.renderTurn(
				lastTurn,
				activities.length - lastTurn.items.length,
			);
			const fresh = tempDiv.firstElementChild;
			if (fresh) turnEl.replaceWith(fresh);
			newActivities.forEach((a) => this._renderedActivityIds.add(a.id));
		} else {
			// Flat feed: append the new items with the slide-in animation.
			const startIdx = this._lastActivityCount;
			newActivities.forEach((activity, i) => {
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = this.renderActivityItem(activity, startIdx + i);
				const newEl = tempDiv.firstElementChild;
				if (newEl) {
					newEl.classList.add("sv-new-item");
					feedEl.appendChild(newEl);
					this._renderedActivityIds.add(activity.id);
				}
			});
		}

		this._lastActivityCount = activities.length;

		// Appended items need no wiring - the detail pane's delegated handler
		// already covers them.

		// Auto-scroll to bottom if enabled
		if (State.sessionView.autoScroll) {
			contentEl.scrollTop = contentEl.scrollHeight;
		}
	},

	/**
	 * Update status of running tools without full re-render
	 * @param {HTMLElement} feedEl
	 * @param {Array} activities
	 */
	updateRunningTools(feedEl, activities) {
		// Find all running tool bubbles
		const runningTools = feedEl.querySelectorAll(".sv-bubble.sv-tool.running");

		runningTools.forEach((toolEl) => {
			const itemId = toolEl.dataset.itemId;
			if (!itemId) return;

			// Match on the activity's stable id. data-item-id holds that id (a
			// backend log UUID), never an array index. The previous code parsed
			// it as one, which failed in two different ways: for an id starting
			// with a letter parseInt gives NaN and the lookup silently misses,
			// but for one starting with digits - 60% of real log ids, measured -
			// it yields an arbitrary small integer, and the lookup can match a
			// DIFFERENT activity, rendering another tool's content into this
			// bubble. Identity matching removes both.
			const idx = activities.findIndex(
				(a) => a.type === "tool_call" && a.id === itemId,
			);
			if (idx === -1) return;

			const activity = activities[idx];
			if (activity.data?.status && activity.data.status !== "running") {
				// Tool completed - update the element in place
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = this.renderActivityItem(activity, idx);
				const newEl = tempDiv.firstElementChild;

				if (newEl) {
					// Safe to swap: handlers are delegated on the detail pane, so
					// the replacement is live without rebinding anything.
					toolEl.replaceWith(newEl);
				}
			}
		});
	},

	/**
	 * Generate a stable hash for a string (for activity IDs)
	 * @param {string} str
	 * @returns {string}
	 */
	hashString(str) {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash = hash & hash;
		}
		return Math.abs(hash).toString(16);
	},

	/**
	 * Generate a stable activity ID
	 * @param {Object} activity
	 * @param {string} type
	 * @returns {string}
	 */
	generateActivityId(activity, type) {
		if (activity.id) return activity.id;

		if (type === "tool_call" && activity.tool) {
			const inputHash = this.hashString(JSON.stringify(activity.input || ""));
			return `tool-${activity.tool}-${activity.startTime}-${inputHash.slice(0, 8)}`;
		}

		const contentHash = this.hashString(
			JSON.stringify(activity.data || activity),
		);
		return `${type}-${activity.timestamp}-${contentHash.slice(0, 8)}`;
	},

	/**
	 * Safely stringify a value for display
	 * @param {*} value
	 * @param {number} maxLength
	 * @returns {string}
	 */
	safeStringify(value, maxLength = 2000) {
		if (value === null || value === undefined) return "";
		try {
			const str =
				typeof value === "object"
					? JSON.stringify(value, null, 2)
					: String(value);
			return str.slice(0, maxLength);
		} catch (e) {
			return "[Unable to display]";
		}
	},

	/**
	 * Safely get an array (returns empty array if not array)
	 * @param {*} arr
	 * @returns {Array}
	 */
	safeArray(arr) {
		return Array.isArray(arr) ? arr : [];
	},

	/**
	 * Group a flat activity list into user turns.
	 *
	 * Exact when items carry promptId, which the CLI supplies on every event
	 * except SessionStart. Sessions logged before promptId was captured have
	 * none, so those fall back to segmenting on user_prompt boundaries - an
	 * approximation, and a poor one on a long session (the largest local session
	 * has 361 tool events against 1 recorded prompt), but better than presenting
	 * historical data as one undifferentiated wall.
	 *
	 * @param {Array} activities in timestamp order
	 * @returns {Array<{key: string, promptId: string|null, prompt: string, items: Array, startTime: string, endTime: string}>}
	 */
	groupIntoTurns(activities) {
		const turns = [];
		const byPromptId = new Map();
		let open = null;

		const startTurn = (promptId) => {
			const turn = {
				key: promptId || `t${turns.length}`,
				promptId: promptId || null,
				prompt: "",
				items: [],
				startTime: "",
				endTime: "",
			};
			turns.push(turn);
			if (promptId) byPromptId.set(promptId, turn);
			return turn;
		};

		for (const activity of activities) {
			const promptId = activity.data?.promptId || null;
			let turn;

			if (promptId) {
				turn = byPromptId.get(promptId) || startTurn(promptId);
			} else if (activity.type === "user_prompt" || !open) {
				turn = startTurn(null);
			} else {
				turn = open;
			}

			if (activity.type === "user_prompt" && !turn.prompt) {
				turn.prompt = String(activity.data?.prompt || "");
			}
			if (!turn.startTime) turn.startTime = activity.timestamp;
			turn.endTime = activity.timestamp;
			turn.items.push(activity);
			open = turn;
		}

		return turns;
	},

	/**
	 * Counts for a turn's header
	 * @param {Object} turn
	 * @returns {{tools: number, errors: number, files: number}}
	 */
	turnStats(turn) {
		let tools = 0;
		let errors = 0;
		const files = new Set();

		for (const item of turn.items) {
			if (item.type !== "tool_call") continue;
			tools++;
			const status = item.data?.status;
			if (status === "failed" || status === "error") errors++;
			if (item.data?.file) files.add(item.data.file);
		}

		return { tools, errors, files: files.size };
	},

	/**
	 * Render one collapsible turn
	 * @param {Object} turn
	 * @param {number} startIdx index of the turn's first item in the flat list
	 * @returns {string}
	 */
	renderTurn(turn, startIdx) {
		const collapsed = this._collapsedTurns.has(turn.key);
		const stats = this.turnStats(turn);
		const label = turn.prompt
			? turn.prompt.replace(/\s+/g, " ").slice(0, 120)
			: "Activity before the first recorded prompt";

		return `
      <div class="sv-turn ${collapsed ? "collapsed" : ""}" data-turn-key="${Utils.escapeHtml(turn.key)}">
        <div class="sv-turn-header" data-turn-key="${Utils.escapeHtml(turn.key)}">
          <span class="sv-turn-caret">${collapsed ? "▶" : "▼"}</span>
          <span class="sv-turn-label" title="${Utils.escapeHtml(label)}">${Utils.escapeHtml(label)}</span>
          <span class="sv-turn-stats">
            <span>${stats.tools} tool${stats.tools === 1 ? "" : "s"}</span>
            ${stats.files > 0 ? `<span>${stats.files} file${stats.files === 1 ? "" : "s"}</span>` : ""}
            ${stats.errors > 0 ? `<span class="sv-turn-errors">${stats.errors} error${stats.errors === 1 ? "" : "s"}</span>` : ""}
            <span>${Utils.formatDuration(turn.startTime, turn.endTime)}</span>
          </span>
        </div>
        <div class="sv-turn-body">
          ${turn.items.map((item, i) => this.renderActivityItem(item, startIdx + i)).join("")}
        </div>
      </div>
    `;
	},

	/**
	 * Collapse every turn but the most recent, once per session. Seeding only
	 * once matters: re-seeding on each poll would undo the user's expansions
	 * every two seconds.
	 * @param {Array} turns
	 * @param {string} sessionId
	 */
	seedTurnCollapse(turns, sessionId) {
		if (this._turnsSeededFor === sessionId) return;
		this._turnsSeededFor = sessionId;
		this._collapsedTurns.clear();
		turns.slice(0, -1).forEach((turn) => this._collapsedTurns.add(turn.key));
	},

	/**
	 * Toggle a turn open or closed
	 * @param {string} key
	 */
	toggleTurn(key) {
		if (!key) return;
		if (this._collapsedTurns.has(key)) {
			this._collapsedTurns.delete(key);
		} else {
			this._collapsedTurns.add(key);
		}

		const el = document.querySelector(
			`.sv-turn[data-turn-key="${CSS.escape(key)}"]`,
		);
		if (!el) {
			this.renderTabContent();
			return;
		}
		const collapsed = this._collapsedTurns.has(key);
		el.classList.toggle("collapsed", collapsed);
		const caret = el.querySelector(".sv-turn-caret");
		if (caret) caret.textContent = collapsed ? "▶" : "▼";
	},

	/**
	 * Coerce a backend activity item into a shape the renderers can trust.
	 *
	 * The contract is produced untyped (`data: unknown` server-side), so this is
	 * the trust boundary. It matters concretely: several renderers reach straight
	 * into `activity.data.x`, which throws if data is null - one malformed item
	 * would take out the whole feed rather than degrading to a single "unknown"
	 * bubble.
	 *
	 * @param {*} raw
	 * @returns {Object|null} null when the item is unusable
	 */
	normalizeActivity(raw) {
		if (!raw || typeof raw !== "object") return null;
		return {
			...raw,
			type: typeof raw.type === "string" ? raw.type : "message",
			timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
			data: raw.data && typeof raw.data === "object" ? raw.data : {},
		};
	},

	/**
	 * Build activity feed from session data
	 * Uses sessionActivity from backend as primary source for activity items
	 * @param {Object} session
	 * @returns {Array}
	 */
	buildActivityFeed(session) {
		const activities = [];
		const seenIds = new Set();
		const { sessionActivity } = State.sessionView;

		// Use sessionActivity from backend as primary source
		// (already includes user_prompt, ai_response, tool_call, etc.)
		if (sessionActivity && sessionActivity.length > 0) {
			sessionActivity.forEach((raw) => {
				const activity = this.normalizeActivity(raw);
				if (!activity) return;
				const activityId = this.generateActivityId(activity, activity.type);
				if (!seenIds.has(activityId)) {
					seenIds.add(activityId);
					activities.push({ ...activity, id: activityId });
				}
			});
		}

		// Add tool executions from session as fallback
		// (in case they're not in sessionActivity yet)
		if (session.toolExecutions) {
			session.toolExecutions.forEach((tool) => {
				const activityId = this.generateActivityId(tool, "tool_call");
				if (!seenIds.has(activityId)) {
					seenIds.add(activityId);
					activities.push({
						id: activityId,
						type: "tool_call",
						timestamp: tool.startTime,
						data: tool,
					});
				}
			});
		}

		// Sort by timestamp
		activities.sort((a, b) => {
			const timeA = new Date(a.timestamp || 0).getTime();
			const timeB = new Date(b.timestamp || 0).getTime();
			return timeA - timeB;
		});

		return activities;
	},

	/**
	 * Banner shown when the feed does not reach the start of the session.
	 * The server caps the activity window; without this the oldest rendered
	 * item reads as the moment the session began.
	 * @param {number} shownCount
	 * @returns {string}
	 */
	renderTruncationNotice(shownCount) {
		const { activityTruncated, activityAvailableLogs } = State.sessionView;
		if (!activityTruncated) return "";

		// Deliberately "available", not "total": the core serves activity reads
		// from its retained window, so this is a floor on what the session
		// actually produced, not a lifetime count.
		const scope =
			typeof activityAvailableLogs === "number"
				? `of ${activityAvailableLogs} available`
				: "of more than are shown";

		return `
      <div class="sv-truncation-notice">
        Earlier activity not loaded &mdash; showing the most recent
        ${shownCount} ${scope}.
      </div>
    `;
	},

	/**
	 * Render a single activity item
	 * @param {Object} activity
	 * @param {number} idx
	 * @returns {string}
	 */
	renderActivityItem(activity, idx) {
		const itemId = activity.id || `activity-${idx}`;
		// Expansion state is resolved per-item by renderToolBubble; only tool
		// bubbles expand, so it is not needed here.
		const timestamp = Utils.formatTime(activity.timestamp);

		switch (activity.type) {
			case "user_prompt":
				return `
          <div class="sv-bubble sv-user" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">User</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(activity.data.prompt || "")}
            </div>
          </div>
        `;

			case "ai_response": {
				// assistantMessage is Claude's real reply text, from Stop's
				// last_assistant_message. Before it was plumbed through, this bubble
				// could only ever show the placeholder below.
				const aiMessage =
					activity.data?.assistantMessage ||
					activity.data?.message ||
					"Claude finished responding";
				// Stop carries no reason field on any Claude Code version - the old
				// stopReason/stop_reason/finish_reason lookup could never match.
				// Failure reasons live on StopFailure, which the core routes to a
				// separate error-level message item rather than attributing an API
				// error to Claude.
				const pending = Number(activity.data?.backgroundTasks) || 0;
				return `
          <div class="sv-bubble sv-ai" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">Claude</span>
              <span class="sv-bubble-time">${timestamp}</span>
              <span class="sv-response-indicator">${pending > 0 ? `Paused &mdash; ${pending} background task${pending === 1 ? "" : "s"}` : "Response Complete"}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(aiMessage)}
            </div>
          </div>
        `;
			}

			case "notification": {
				const notifData = activity.data || {};
				const notifType = notifData.notificationType || "";
				const notifIcon =
					notifType === "permission_prompt"
						? "🔐"
						: notifType === "idle_prompt"
							? "⏸️"
							: "🔔";
				return `
          <div class="sv-bubble sv-notification" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">${notifIcon} Notification</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(notifData.message || "")}
            </div>
          </div>
        `;
			}

			case "tool_call":
				return this.renderToolBubble(activity.data, idx, itemId);

			case "session_start": {
				const sessionData = activity.data || {};
				return `
          <div class="sv-bubble sv-session" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">Session Started</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${sessionData.projectName ? `<span class="sv-session-project">${Utils.escapeHtml(sessionData.projectName)}</span>` : ""}
              ${sessionData.gitBranch ? `<span class="sv-session-branch">${Utils.escapeHtml(sessionData.gitBranch)}</span>` : ""}
            </div>
          </div>
        `;
			}

			case "subagent_complete": {
				const subagentData = activity.data || {};
				const success = subagentData.success !== false;
				const statusIcon = success ? "✅" : "❌";
				const statusClass = success
					? "sv-subagent-success"
					: "sv-subagent-failed";
				const agentType = subagentData.subagentType || "Task";
				return `
          <div class="sv-bubble sv-subagent ${statusClass}" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">${statusIcon} Subagent: ${Utils.escapeHtml(agentType)}</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(subagentData.message || `${agentType} agent ${success ? "completed" : "failed"}`)}
            </div>
          </div>
        `;
			}

			case "message": {
				const msgData = activity.data || {};
				const levelClass =
					msgData.level === "error"
						? "sv-message-error"
						: msgData.level === "warn"
							? "sv-message-warn"
							: "";

				// A turn that ended on an API error arrives here rather than as an
				// ai_response, because StopFailure reuses last_assistant_message to
				// carry the error string. Name the failure instead of letting it
				// read as an ordinary hook message.
				if (msgData.stopError) {
					return `
          <div class="sv-bubble sv-message sv-message-error" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">&#9888; Turn failed</span>
              <span class="sv-bubble-time">${timestamp}</span>
              <span class="sv-stop-error-code">${Utils.escapeHtml(String(msgData.stopError))}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(String(msgData.errorDetails || msgData.message || "Claude stopped before finishing this turn."))}
            </div>
          </div>
        `;
				}

				return `
          <div class="sv-bubble sv-message ${levelClass}" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">${Utils.escapeHtml(msgData.hook || "Message")}</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(msgData.message || "")}
            </div>
          </div>
        `;
			}

			default: {
				// Handle unknown activity types gracefully
				console.warn(
					`[SessionsView] Unknown activity type: ${activity.type}`,
					activity,
				);
				return `
          <div class="sv-bubble sv-unknown" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">&#9888; ${Utils.escapeHtml(activity.type || "Unknown")}</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${
								activity.data?.message
									? Utils.escapeHtml(String(activity.data.message))
									: `<em>Activity type "${Utils.escapeHtml(activity.type || "unknown")}" not recognized</em>`
							}
            </div>
          </div>
        `;
			}
		}
	},

	/**
	 * Render a tool call bubble
	 * @param {Object} tool
	 * @param {number} idx
	 * @param {string} activityId - Optional activity ID for tracking
	 * @returns {string}
	 */
	renderToolBubble(tool, idx, activityId) {
		const itemId = activityId || tool.id || `tool-${idx}`;
		const isExpanded = this._expandedItems.has(itemId);
		const timestamp = Utils.formatTime(tool.startTime);
		const status = tool.status || "completed";
		const isRunning = status === "running";
		const hasError = status === "error" || status === "failed";
		const toolName = tool.tool || "Unknown";
		const toolType = this.getToolType(toolName);

		const duration = this.formatToolDuration(tool);

		return `
      <div class="sv-bubble sv-tool ${status} ${isExpanded ? "expanded" : ""}" data-item-id="${itemId}">
        <div class="sv-bubble-header">
          <span class="sv-tool-badge ${toolType}">${Utils.escapeHtml(toolName)}</span>
          ${
						tool.agentType
							? `<span class="sv-agent-badge" title="Run by subagent: ${Utils.escapeHtml(tool.agentType)}">${Utils.escapeHtml(tool.agentType)}</span>`
							: ""
					}
          <span class="sv-bubble-time">${timestamp}</span>
          ${isRunning ? '<span class="sv-spinner"></span>' : ""}
          ${hasError ? '<span class="sv-error-badge">Error</span>' : ""}
          ${duration && !isRunning ? `<span class="sv-tool-duration">${duration}</span>` : ""}
          <span class="sv-tool-status ${status}">${this.getStatusIcon(status)}</span>
        </div>
        ${
					isExpanded
						? `
          ${this.renderToolDetails(tool)}
          <button class="sv-expand-btn" data-item-id="${itemId}">
            Hide details
          </button>
        `
						: `
          <button class="sv-expand-btn" data-item-id="${itemId}">
            Show details
          </button>
        `
				}
      </div>
    `;
	},

	/**
	 * Render expanded tool details
	 * @param {Object} tool
	 * @returns {string}
	 */
	renderToolDetails(tool) {
		const inputStr = this.safeStringify(tool.input, 5000);
		const outputStr = this.safeStringify(tool.result, 2000);
		const affectedFiles = this.safeArray(tool.affectedFiles);
		const inputCopyKey = inputStr ? this.registerCopyPayload(inputStr) : "";
		const outputCopyKey = outputStr ? this.registerCopyPayload(outputStr) : "";

		return `
      <div class="sv-tool-details">
        ${
					inputStr
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Input</span>
              <button class="sv-copy-btn" data-copy-key="${inputCopyKey}">Copy</button>
            </div>
            <div class="sv-code-block" style="max-height: 300px; overflow: auto;">
              <pre>${Utils.highlightCode(inputStr, "json")}</pre>
            </div>
          </div>
        `
						: ""
				}
        ${
					outputStr
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Output</span>
              <button class="sv-copy-btn" data-copy-key="${outputCopyKey}">Copy</button>
            </div>
            <div class="sv-code-block" style="max-height: 300px; overflow: auto;">
              <pre>${Utils.highlightCode(outputStr, Utils.detectLanguage(tool.affectedFiles?.[0] || "", outputStr))}</pre>
            </div>
          </div>
        `
						: ""
				}
        ${
					tool.error
						? `
          <div class="sv-tool-section error">
            <div class="sv-tool-section-header">
              <span>Error</span>
            </div>
            <div class="sv-error-content">${Utils.escapeHtml(tool.error)}</div>
          </div>
        `
						: ""
				}
        ${
					affectedFiles.length > 0
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Affected Files</span>
            </div>
            <div class="sv-affected-files">
              ${affectedFiles
								.map(
									(f) => `
                <span class="sv-file-chip">${Utils.escapeHtml(Utils.getFileName(f))}</span>
              `,
								)
								.join("")}
            </div>
          </div>
        `
						: ""
				}
      </div>
    `;
	},

	/**
	 * Setup activity item handlers
	 * @param {HTMLElement} container
	 */
	setupActivityHandlers() {
		const contentEl = document.getElementById("sv-detail-content");
		if (!contentEl || contentEl.dataset.svDelegated === "1") return;
		contentEl.dataset.svDelegated = "1";

		// One delegated listener for the whole detail pane. Previously handlers
		// were attached per item on every render, so a feed of several hundred
		// items re-bound several hundred listeners on each 2s tick and on every
		// expand click - and any node replaced in place silently lost its own.
		contentEl.addEventListener("click", (e) => {
			const copyBtn = e.target.closest(".sv-copy-btn");
			if (copyBtn) {
				e.stopPropagation();
				this.handleCopyClick(copyBtn);
				return;
			}

			const expandBtn = e.target.closest(".sv-expand-btn");
			if (expandBtn) {
				e.stopPropagation();
				this.toggleExpand(expandBtn.dataset.itemId);
				return;
			}

			const toolHeader = e.target.closest(".sv-tool-item-header");
			if (toolHeader) {
				this.toggleExpand(toolHeader.dataset.itemId);
				return;
			}

			const turnHeader = e.target.closest(".sv-turn-header");
			if (turnHeader) {
				this.toggleTurn(turnHeader.dataset.turnKey);
			}
		});
	},

	/**
	 * Copy a stashed payload to the clipboard
	 * @param {HTMLElement} btn
	 */
	handleCopyClick(btn) {
		const text = this._copyPayloads.get(btn.dataset.copyKey);
		if (text === undefined) return;
		navigator.clipboard.writeText(text).then(() => {
			btn.textContent = "Copied!";
			setTimeout(() => (btn.textContent = "Copy"), 1500);
		});
	},

	/**
	 * Render the Tools tab
	 * @param {HTMLElement} container
	 * @param {Object} session
	 */
	renderToolsTab(container, session) {
		const tools = session.toolExecutions || [];

		if (tools.length === 0) {
			container.innerHTML = `
        <div class="sv-tools-empty">
          <div class="empty-state">
            <div class="empty-state-title">No tools executed</div>
            <div class="empty-state-description">Tool executions will appear here</div>
          </div>
        </div>
      `;
			return;
		}

		// Full rebuild - see renderActivityTab
		this._copyPayloads.clear();

		container.innerHTML = `
      <div class="sv-tools-list">
        ${tools.map((tool, idx) => this.renderToolItem(tool, idx)).join("")}
      </div>
    `;
	},

	/**
	 * Render one row of the Tools tab
	 * @param {Object} tool
	 * @param {number} idx
	 * @returns {string}
	 */
	renderToolItem(tool, idx) {
		const itemId = this.toolItemId(idx);
		const isExpanded = this._expandedItems.has(itemId);
		const timestamp = Utils.formatTime(tool.startTime);
		const status = tool.status || "completed";
		const toolType = this.getToolType(tool.tool);
		const duration = this.formatToolDuration(tool);

		return `
      <div class="sv-tool-item ${status} ${isExpanded ? "expanded" : ""}" data-item-id="${itemId}">
        <div class="sv-tool-item-header" data-item-id="${itemId}">
          <span class="sv-tool-index">${idx + 1}</span>
          <span class="sv-tool-badge ${toolType}">${Utils.escapeHtml(tool.tool || "Unknown")}</span>
          <span class="sv-tool-time">${timestamp}</span>
          ${duration ? `<span class="sv-tool-duration">${duration}</span>` : ""}
          <span class="sv-tool-status ${status}">${this.getStatusIcon(status)}</span>
          <span class="sv-tool-expand" title="${isExpanded ? "Hide details" : "Show details"}">${isExpanded ? "▲" : "▼"}</span>
        </div>
        ${isExpanded ? this.renderToolDetails(tool) : ""}
      </div>
    `;
	},

	/**
	 * Stable item id for a Tools-tab row
	 * @param {number} idx
	 * @returns {string}
	 */
	toolItemId(idx) {
		return `tools-tab-${idx}`;
	},

	/**
	 * Format a tool execution's duration.
	 *
	 * Prefers the hook-reported duration. Hook timestamps are second-resolution
	 * (the script stamps `date -u +...%SZ`), so subtracting them can only ever
	 * yield a multiple of 1000ms or 0 - fiction for calls that take tens of ms.
	 *
	 * The real figure arrives as `details.durationMs`. SessionManager assigns
	 * `exec.result = log.details`, so on a ToolExecution it surfaces under
	 * `result.durationMs`; a future direct field is checked first. Activity-tab
	 * bubbles do not carry it yet - getActivity picks `details.tool_result` as
	 * `result`, which drops the sibling keys - so those still fall back.
	 *
	 * @param {Object} tool
	 * @returns {string}
	 */
	formatToolDuration(tool) {
		const reported =
			typeof tool.durationMs === "number"
				? tool.durationMs
				: typeof tool.result?.durationMs === "number"
					? tool.result.durationMs
					: null;
		if (reported !== null) return `${reported}ms`;

		if (tool.startTime && tool.endTime) {
			return `${new Date(tool.endTime) - new Date(tool.startTime)}ms`;
		}
		return "";
	},

	/**
	 * Render the Logs tab
	 * @param {HTMLElement} container
	 * @param {Object} session
	 */
	renderLogsTab(container, session) {
		const { sessionLogs } = State.sessionView;

		// Request logs for this session if not loaded
		if (!sessionLogs || sessionLogs.length === 0) {
			API.getSessionLogs(session.id);
			container.innerHTML = `
        <div class="sv-logs-loading">
          <div class="empty-state">
            <div class="empty-state-title">Loading logs...</div>
          </div>
        </div>
      `;
			return;
		}

		container.innerHTML = `
      <div class="sv-logs-table">
        <div class="sv-logs-header">
          <span class="sv-logs-col-time">Time</span>
          <span class="sv-logs-col-level">Level</span>
          <span class="sv-logs-col-hook">Hook</span>
          <span class="sv-logs-col-message">Message</span>
        </div>
        <div class="sv-logs-body">
          ${sessionLogs
						.map(
							(log) => `
            <div class="sv-logs-row ${log.level || "info"}">
              <span class="sv-logs-col-time">${Utils.formatTime(log.timestamp)}</span>
              <span class="sv-logs-col-level">
                <span class="sv-level-badge ${log.level || "info"}">${log.level || "info"}</span>
              </span>
              <span class="sv-logs-col-hook">${Utils.escapeHtml(log.hook || "-")}</span>
              <span class="sv-logs-col-message">${Utils.escapeHtml(log.message || "")}</span>
            </div>
          `,
						)
						.join("")}
        </div>
      </div>
    `;
	},

	/**
	 * Get tool type for styling
	 * @param {string} toolName
	 * @returns {string}
	 */
	getToolType(toolName) {
		const name = (toolName || "").toLowerCase();
		if (name.includes("read")) return "read";
		if (name.includes("write")) return "write";
		if (name.includes("edit")) return "edit";
		if (name.includes("bash") || name.includes("execute")) return "bash";
		if (
			name.includes("glob") ||
			name.includes("grep") ||
			name.includes("search")
		)
			return "search";
		if (name.includes("task") || name.includes("agent")) return "agent";
		return "other";
	},

	/**
	 * Get status icon
	 * @param {string} status
	 * @returns {string}
	 */
	getStatusIcon(status) {
		switch (status) {
			case "completed":
			case "success":
				return "&#10003;";
			case "error":
			case "failed":
				return "&#10007;";
			case "running":
				return "&#8226;";
			default:
				return "&#8226;";
		}
	},

	/**
	 * Toggle item expansion
	 * @param {string} itemId
	 */
	toggleExpand(itemId) {
		if (!itemId) return;

		if (this._expandedItems.has(itemId)) {
			this._expandedItems.delete(itemId);
		} else {
			this._expandedItems.add(itemId);
		}

		// Re-render only the item that changed. This used to call
		// renderTabContent(), rebuilding every item's HTML and re-binding every
		// handler for one click - on a session with hundreds of executions that
		// is the whole feed per toggle.
		if (!this.renderSingleItem(itemId)) {
			this.renderTabContent();
		}
	},

	/**
	 * Replace one rendered item in place.
	 * @param {string} itemId
	 * @returns {boolean} false if the item could not be resolved (caller should
	 *   fall back to a full render)
	 */
	renderSingleItem(itemId) {
		const contentEl = document.getElementById("sv-detail-content");
		if (!contentEl) return false;

		const el = contentEl.querySelector(
			`[data-item-id="${CSS.escape(itemId)}"]`,
		);
		if (!el) return false;

		const session = this.getSelectedSession();
		if (!session) return false;

		const { activeTab } = State.sessionView;

		if (activeTab === "tools") {
			const idx = Number.parseInt(itemId.replace("tools-tab-", ""), 10);
			const tool = (session.toolExecutions || [])[idx];
			if (!tool) return false;
			el.outerHTML = this.renderToolItem(tool, idx);
			return true;
		}

		if (activeTab === "activity") {
			const activities = this.buildActivityFeed(session);
			const idx = activities.findIndex((a) => a.id === itemId);
			if (idx === -1) return false;
			el.outerHTML = this.renderActivityItem(activities[idx], idx);
			return true;
		}

		return false;
	},

	/**
	 * Switch to a different tab
	 * @param {string} tabName
	 */
	switchTab(tabName) {
		// Reset scroll position when switching tabs
		const contentEl = document.getElementById("sv-detail-content");
		if (contentEl) {
			contentEl.scrollTop = 0;
		}

		State.update("sessionView", {
			...State.sessionView,
			activeTab: tabName,
		});

		// Load data for the new tab if needed
		const session = this.getSelectedSession();
		if (session) {
			if (tabName === "logs") {
				API.getSessionLogs(session.id);
			} else if (tabName === "activity") {
				API.getSessionActivity(session.id);
			} else if (tabName === "tools") {
				// The Tools tab is the one view that needs the full toolExecutions
				// array, which sessionSummary omits. Fetch it on tab entry rather
				// than on every poll tick - once per switch, not once per 2s.
				API.getSession(session.id);
			}
		}
	},

	/**
	 * Select a session
	 * @param {string} sessionId
	 */
	selectSession(sessionId) {
		// Drop all per-session render state; none of it applies to the new
		// session and every entry would otherwise leak for the panel's lifetime.
		this._expandedItems.clear();
		this._renderedActivityIds.clear();
		this._copyPayloads.clear();
		this._collapsedTurns.clear();
		this._renderedTurnKeys = [];
		this._turnsSeededFor = null;
		this._lastActivityCount = 0;

		State.update("sessionView", {
			...State.sessionView,
			selectedSession: sessionId,
			activeTab: "activity",
			sessionActivity: [],
			sessionLogs: [],
		});

		// Load session data
		API.getSession(sessionId);
		API.getSessionActivity(sessionId);
		API.getSessionLogs(sessionId);
	},

	/**
	 * Show delete confirmation modal
	 * @param {string} sessionId
	 */
	confirmDeleteSession(sessionId) {
		const session = State.sessions.find((s) => s.id === sessionId);
		const sessionName = session
			? this.getSessionDisplayName(session)
			: sessionId.slice(0, 8);

		const modal = document.createElement("div");
		modal.className = "modal-overlay";
		modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-title">Delete Session</span>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete session <strong>${Utils.escapeHtml(sessionName)}</strong>?</p>
          <p class="modal-warning">This will also delete all associated logs and file changes. This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary modal-cancel">Cancel</button>
          <button class="btn btn-danger modal-confirm">Delete</button>
        </div>
      </div>
    `;

		document.body.appendChild(modal);
		requestAnimationFrame(() => modal.classList.add("visible"));

		modal.querySelector(".modal-cancel")?.addEventListener("click", () => {
			modal.classList.remove("visible");
			setTimeout(() => modal.remove(), 200);
		});

		modal.querySelector(".modal-confirm")?.addEventListener("click", () => {
			API.deleteSession(sessionId);

			// Clear selection if deleting selected session
			if (State.sessionView.selectedSession === sessionId) {
				State.update("sessionView", {
					...State.sessionView,
					selectedSession: null,
					sessionActivity: [],
					sessionLogs: [],
				});
			}

			modal.classList.remove("visible");
			setTimeout(() => modal.remove(), 200);
		});

		modal.addEventListener("click", (e) => {
			if (e.target === modal) {
				modal.classList.remove("visible");
				setTimeout(() => modal.remove(), 200);
			}
		});
	},
};

// Register view with router
Router.register("sessions", SessionsView);

// Make globally available
window.SessionsView = SessionsView;
