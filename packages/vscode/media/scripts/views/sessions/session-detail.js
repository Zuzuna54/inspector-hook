/**
 * Detail pane: header, sub-tabs, Tools and Logs.
 *
 * Moved verbatim out of the 1539-line views/sessions.js. Composed onto
 * SessionsView with Object.assign, so `this` resolves exactly as before.
 */

const SessionDetailMixin = {

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
};

window.SessionDetailMixin = SessionDetailMixin;
