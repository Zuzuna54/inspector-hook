/**
 * The sidebar: filtering, sorting, cards, selection, deletion.
 *
 * Moved verbatim out of the 1539-line views/sessions.js. Composed onto
 * SessionsView with Object.assign, so `this` resolves exactly as before.
 */

const SessionListMixin = {

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

window.SessionListMixin = SessionListMixin;
