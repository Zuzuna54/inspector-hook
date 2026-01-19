/**
 * Sessions View - Complete Redesign
 * Split-panel layout with Activity, Tools, and Logs tabs
 */

const SessionsView = {
	// Subscription cleanup functions
	_unsubscribers: [],

	// Expanded items tracking
	_expandedItems: new Set(),

	// Auto-refresh interval for active sessions
	_refreshInterval: null,

	// Track rendered activity items to avoid full re-renders
	_renderedActivityIds: new Set(),
	_lastActivityCount: 0,

	/**
	 * Get a human-readable display name for a session
	 * Returns an object with projectName and shortId
	 * @param {Object} session
	 * @returns {{ projectName: string, shortId: string, fullDisplay: string }}
	 */
	getSessionDisplayInfo(session) {
		let projectName = "";

		// 1. Try project name from metadata
		if (session.metadata?.projectName) {
			projectName = session.metadata.projectName;
		}
		// 2. Try to extract folder name from working directory
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
		if (includeBranch && session.metadata?.gitBranch) {
			return `${info.fullDisplay} (${session.metadata.gitBranch})`;
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
		this._refreshInterval = setInterval(() => {
			const selectedSession = this.getSelectedSession();
			if (selectedSession && selectedSession.status === "active") {
				API.getSession(selectedSession.id);
				API.getSessionActivity(selectedSession.id);
			}
		}, 2000);
	},

	/**
	 * Stop auto-refresh
	 */
	stopAutoRefresh() {
		if (this._refreshInterval) {
			clearInterval(this._refreshInterval);
			this._refreshInterval = null;
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

		// Sort: active first, then by startTime descending
		return [...filtered].sort((a, b) => {
			// Active sessions first
			if (a.status === "active" && b.status !== "active") return -1;
			if (b.status === "active" && a.status !== "active") return 1;

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
		if (!session.toolExecutions) return 0;
		return session.toolExecutions.filter(
			(t) => t.status === "error" || t.status === "failed",
		).length;
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
				const toolCount = session.toolExecutions?.length || 0;
				const fileCount = session.fileChanges?.length || 0;
				const errorCount = this.countErrors(session);
				const statusClass = session.status || "unknown";
				const hasErrors = errorCount > 0;
				const displayInfo = this.getSessionDisplayInfo(session);
				const gitBranch = session.metadata?.gitBranch;

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
		const toolCount = session.toolExecutions?.length || 0;
		const fileCount = session.fileChanges?.length || 0;
		const errorCount = this.countErrors(session);
		const displayName = this.getSessionDisplayName(session);
		const gitBranch = session.metadata?.gitBranch;

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

		// Track rendered items for incremental updates
		this._renderedActivityIds.clear();
		activities.forEach((activity, idx) => {
			this._renderedActivityIds.add(activity.id || `idx-${idx}`);
		});
		this._lastActivityCount = activities.length;

		container.innerHTML = `
      <div class="sv-activity-feed">
        ${activities.map((activity, idx) => this.renderActivityItem(activity, idx)).join("")}
      </div>
    `;

		// Set up expand/collapse handlers
		this.setupActivityHandlers(container);
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
		const newActivities = activities.filter((activity, idx) => {
			const itemId = activity.id || `idx-${idx}`;
			return !this._renderedActivityIds.has(itemId);
		});

		if (newActivities.length === 0) {
			// No new items, maybe update running tool statuses
			this.updateRunningTools(feedEl, activities);
			return;
		}

		// Append new items
		const startIdx = this._lastActivityCount;
		newActivities.forEach((activity, i) => {
			const idx = startIdx + i;
			const itemId = activity.id || `idx-${idx}`;

			// Create new element
			const tempDiv = document.createElement("div");
			tempDiv.innerHTML = this.renderActivityItem(activity, idx);
			const newEl = tempDiv.firstElementChild;

			if (newEl) {
				// Add slide-in animation
				newEl.classList.add("sv-new-item");
				feedEl.appendChild(newEl);

				// Track as rendered
				this._renderedActivityIds.add(itemId);
			}
		});

		this._lastActivityCount = activities.length;

		// Re-setup handlers for new items
		this.setupActivityHandlers(contentEl);

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

			// Find corresponding activity
			const idx = parseInt(itemId.replace("tool-", ""), 10);
			const activity = activities.find(
				(a, i) => a.type === "tool_call" && i === idx,
			);

			if (activity && activity.data?.status !== "running") {
				// Tool completed - update the element in place
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = this.renderActivityItem(activity, idx);
				const newEl = tempDiv.firstElementChild;

				if (newEl) {
					// Preserve expanded state
					if (this._expandedItems.has(itemId)) {
						newEl.classList.add("expanded");
					}
					toolEl.replaceWith(newEl);
				}
			}
		});
	},

	/**
	 * Build activity feed from session data
	 * @param {Object} session
	 * @returns {Array}
	 */
	buildActivityFeed(session) {
		const activities = [];

		// Get user prompts from session logs
		const { sessionLogs, sessionActivity } = State.sessionView;

		// Add user prompts from logs with hook === 'UserPromptSubmit'
		sessionLogs.forEach((log) => {
			if (log.hook === "UserPromptSubmit" && log.details?.prompt) {
				activities.push({
					type: "user_prompt",
					timestamp: log.timestamp,
					data: {
						prompt: log.details.prompt,
					},
				});
			}
		});

		// Add tool executions
		if (session.toolExecutions) {
			session.toolExecutions.forEach((tool) => {
				activities.push({
					type: "tool_call",
					timestamp: tool.startTime,
					data: tool,
				});
			});
		}

		// Add any activities from the activity API
		if (sessionActivity && sessionActivity.length > 0) {
			sessionActivity.forEach((activity) => {
				// Avoid duplicates by checking timestamp
				const exists = activities.some(
					(a) => a.type === activity.type && a.timestamp === activity.timestamp,
				);
				if (!exists) {
					activities.push(activity);
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
	 * Render a single activity item
	 * @param {Object} activity
	 * @param {number} idx
	 * @returns {string}
	 */
	renderActivityItem(activity, idx) {
		const itemId = `activity-${idx}`;
		const isExpanded = this._expandedItems.has(itemId);
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
				const aiMessage = activity.data.message || "Claude finished responding";
				const stopReason = activity.data.stopReason || "";
				return `
          <div class="sv-bubble sv-ai" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">Claude</span>
              <span class="sv-bubble-time">${timestamp}</span>
              <span class="sv-response-indicator">Response Complete</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(aiMessage)}
              ${stopReason ? `<div class="sv-stop-reason">${Utils.escapeHtml(stopReason)}</div>` : ""}
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
				return this.renderToolBubble(activity.data, idx);

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

			case "message": {
				const msgData = activity.data || {};
				const levelClass =
					msgData.level === "error"
						? "sv-message-error"
						: msgData.level === "warn"
							? "sv-message-warn"
							: "";
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

			default:
				return "";
		}
	},

	/**
	 * Render a tool call bubble
	 * @param {Object} tool
	 * @param {number} idx
	 * @returns {string}
	 */
	renderToolBubble(tool, idx) {
		const itemId = `tool-${idx}`;
		const isExpanded = this._expandedItems.has(itemId);
		const timestamp = Utils.formatTime(tool.startTime);
		const status = tool.status || "completed";
		const isRunning = status === "running";
		const hasError = status === "error" || status === "failed";
		const toolName = tool.tool || "Unknown";
		const toolType = this.getToolType(toolName);

		// Calculate duration
		let duration = "";
		if (tool.startTime && tool.endTime) {
			duration = `${new Date(tool.endTime) - new Date(tool.startTime)}ms`;
		}

		return `
      <div class="sv-bubble sv-tool ${status} ${isExpanded ? "expanded" : ""}" data-item-id="${itemId}">
        <div class="sv-bubble-header">
          <span class="sv-tool-badge ${toolType}">${Utils.escapeHtml(toolName)}</span>
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
		const inputStr = tool.input
			? typeof tool.input === "object"
				? JSON.stringify(tool.input, null, 2)
				: String(tool.input)
			: "";
		const outputStr = tool.result
			? typeof tool.result === "object"
				? JSON.stringify(tool.result, null, 2)
				: String(tool.result).slice(0, 2000)
			: "";

		return `
      <div class="sv-tool-details">
        ${
					inputStr
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Input</span>
              <button class="sv-copy-btn" data-copy="${Utils.escapeHtml(inputStr)}">Copy</button>
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
              <button class="sv-copy-btn" data-copy="${Utils.escapeHtml(outputStr)}">Copy</button>
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
					tool.affectedFiles && tool.affectedFiles.length > 0
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Affected Files</span>
            </div>
            <div class="sv-affected-files">
              ${tool.affectedFiles
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
	setupActivityHandlers(container) {
		// Expand/collapse buttons
		container.querySelectorAll(".sv-expand-btn").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const itemId = btn.dataset.itemId;
				this.toggleExpand(itemId);
			});
		});

		// Copy buttons
		container.querySelectorAll(".sv-copy-btn").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const text = btn.dataset.copy;
				navigator.clipboard.writeText(text).then(() => {
					btn.textContent = "Copied!";
					setTimeout(() => (btn.textContent = "Copy"), 1500);
				});
			});
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

		container.innerHTML = `
      <div class="sv-tools-list">
        ${tools
					.map((tool, idx) => {
						const itemId = `tools-tab-${idx}`;
						const isExpanded = this._expandedItems.has(itemId);
						const timestamp = Utils.formatTime(tool.startTime);
						const status = tool.status || "completed";
						const toolType = this.getToolType(tool.tool);

						let duration = "";
						if (tool.startTime && tool.endTime) {
							duration = `${new Date(tool.endTime) - new Date(tool.startTime)}ms`;
						}

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
					})
					.join("")}
      </div>
    `;

		// Add click handlers for tool items
		container.querySelectorAll(".sv-tool-item-header").forEach((header) => {
			header.addEventListener("click", () => {
				const itemId = header.dataset.itemId;
				this.toggleExpand(itemId);
			});
		});

		// Setup copy handlers
		this.setupActivityHandlers(container);
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
		if (this._expandedItems.has(itemId)) {
			this._expandedItems.delete(itemId);
		} else {
			this._expandedItems.add(itemId);
		}
		this.renderTabContent();
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
			}
		}
	},

	/**
	 * Select a session
	 * @param {string} sessionId
	 */
	selectSession(sessionId) {
		// Clear expanded items when selecting new session
		this._expandedItems.clear();

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
