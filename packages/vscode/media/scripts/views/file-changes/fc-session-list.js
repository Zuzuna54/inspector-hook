/**
 * File Changes: the sidebar - sessions, files, and selecting one to view.
 *
 * Moved verbatim out of file-changes.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const FcSessionListMixin = {
	/**
	 * Get sessions from state
	 */
	_getSessions() {
		return typeof State !== "undefined" && State.sessions ? State.sessions : [];
	},

	/**
	 * Group changes by session, then by file path
	 */
	_groupBySession(changes) {
		const sessions = this._getSessions();
		const groups = new Map();

		changes.forEach((change) => {
			const sessionId = change.sessionId || "unknown";
			if (!groups.has(sessionId)) {
				const session = sessions.find((s) => s.id === sessionId) || {
					id: sessionId,
				};
				groups.set(sessionId, { session, fileMap: new Map() });
			}

			const group = groups.get(sessionId);
			const filePath = change.filePath;

			// Group by file path within session
			if (!group.fileMap.has(filePath)) {
				group.fileMap.set(filePath, {
					filePath,
					changes: [],
					totalAdditions: 0,
					totalDeletions: 0,
					tools: new Set(),
				});
			}

			const fileGroup = group.fileMap.get(filePath);
			fileGroup.changes.push(change);
			fileGroup.totalAdditions += change.additions || 0;
			fileGroup.totalDeletions += change.deletions || 0;
			if (change.tool) fileGroup.tools.add(change.tool);
		});

		// Convert to array and sort
		return Array.from(groups.values())
			.map(({ session, fileMap }) => ({
				session,
				files: Array.from(fileMap.values()),
			}))
			.sort((a, b) => {
				const timeA = new Date(a.session.startTime || 0).getTime();
				const timeB = new Date(b.session.startTime || 0).getTime();
				return timeB - timeA;
			});
	},

	/**
	 * Get session display name.
	 *
	 * Delegates to the shared derivation in session-utils.js rather than keeping
	 * a third copy of it (Sessions view and SessionManager have the others), so
	 * a session is named the same wherever it appears. The trailing "..." on the
	 * id fallback is preserved from the previous local implementation.
	 */
	_getSessionName(session) {
		const info = window.SessionUtils.getSessionDisplayInfo(session);
		if (info.projectName) return info.projectName;
		return session.id ? `${info.shortId}...` : "Unknown Session";
	},

	/**
	 * Get tool type for badge styling
	 */
	_getToolType(tool) {
		if (!tool) return "unknown";
		const toolLower = tool.toLowerCase();
		if (toolLower.includes("edit")) return "edit";
		if (toolLower.includes("write")) return "write";
		if (toolLower.includes("bash")) return "bash";
		if (toolLower.includes("read")) return "read";
		return "unknown";
	},

	// ==========================================================================
	// Sidebar Rendering
	// ==========================================================================

	/**
	 * Render the sidebar with sessions and files
	 */
	renderSidebar() {
		const container = document.getElementById("fc-session-list");
		if (!container) return;

		const changes = this._getFileChanges();
		const pendingChanges = changes.filter((c) => c.status === "pending");

		// Update pending count
		const countEl = document.getElementById("fc-pending-count");
		if (countEl) {
			countEl.textContent = `${pendingChanges.length} pending`;
		}

		if (pendingChanges.length === 0) {
			container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No pending changes</div>
          <div class="empty-state-description">File changes will appear here when Claude Code modifies files</div>
        </div>
      `;
			return;
		}

		const sessionGroups = this._groupBySession(pendingChanges);

		container.innerHTML = sessionGroups
			.map(({ session, files }) => {
				const isExpanded = this._expandedSessions.has(session.id);
				const duration = session.startTime
					? Utils.formatDuration(session.startTime, session.endTime)
					: "";
				// Was metadata.projectName || metadata.cwd. SessionManager never
				// writes a `cwd` key -- it writes workingDirectory -- so that
				// fallback was dead, and a session without an explicit
				// projectName showed nothing. The shared derivation reads
				// workingDirectory and yields the folder name.
				const projectName =
					window.SessionUtils.getSessionDisplayInfo(session).projectName || "";
				const totalChanges = files.reduce(
					(sum, f) => sum + f.changes.length,
					0,
				);

				return `
        <div class="fc-session ${isExpanded ? "expanded" : ""}" data-session-id="${session.id}">
          <div class="fc-session-header" data-session-id="${session.id}">
            <span class="fc-expand-icon">${isExpanded ? "&#9660;" : "&#9654;"}</span>
            <div class="fc-session-info">
              <span class="fc-session-name">${Utils.escapeHtml(this._getSessionName(session))}</span>
              <span class="fc-session-meta">${duration ? duration + " ago" : ""} &bull; ${files.length} file${files.length !== 1 ? "s" : ""} &bull; ${totalChanges} change${totalChanges !== 1 ? "s" : ""}</span>
              ${projectName ? `<span class="fc-session-project">${Utils.escapeHtml(projectName)}</span>` : ""}
            </div>
            <div class="fc-session-actions">
              <button class="btn btn-xs btn-success fc-session-keep" data-session-id="${session.id}" title="Keep all changes in this session">Keep All</button>
              <button class="btn btn-xs btn-danger fc-session-revert" data-session-id="${session.id}" title="Revert all changes in this session">Revert All</button>
            </div>
          </div>
          ${
						isExpanded
							? `
            <div class="fc-session-content">
              ${files.map((fileGroup) => this._renderFileAccordion(fileGroup, session.id)).join("")}
            </div>
          `
							: ""
					}
        </div>
      `;
			})
			.join("");

		this._setupSidebarHandlers(container);
		this._updateArchiveCount();
	},

	/**
	 * Render a file accordion with hunk list
	 */
	_renderFileAccordion(fileGroup, sessionId) {
		const { filePath, changes, totalAdditions, totalDeletions, tools } =
			fileGroup;
		const fileKey = `${sessionId}:${filePath}`;
		const isFileExpanded = this._expandedFiles.has(fileKey);
		const isSelected = this._selectedFileKey === fileKey;
		const toolsArray = Array.from(tools);
		const primaryTool = toolsArray[0] || "unknown";
		const toolType = this._getToolType(primaryTool);

		return `
      <div class="fc-file-accordion ${isFileExpanded ? "expanded" : ""} ${isSelected ? "selected" : ""}"
           data-file-key="${Utils.escapeHtml(fileKey)}"
           data-session-id="${sessionId}"
           data-file-path="${Utils.escapeHtml(filePath)}">
        <div class="fc-file-header" data-file-key="${Utils.escapeHtml(fileKey)}">
          <span class="fc-file-expand-icon">${isFileExpanded ? "&#9660;" : "&#9654;"}</span>
          <div class="fc-file-info">
            <span class="fc-file-name" title="${Utils.escapeHtml(filePath)}">${Utils.escapeHtml(Utils.getShortPath(filePath))}</span>
            <span class="fc-file-meta">
              <span class="fc-file-stats">
                ${totalAdditions ? `<span class="additions">+${totalAdditions}</span>` : ""}
                ${totalDeletions ? `<span class="deletions">-${totalDeletions}</span>` : ""}
              </span>
              <span class="fc-change-count">${changes.length} hunk${changes.length !== 1 ? "s" : ""}</span>
              <span class="fc-tool-badge ${toolType}">${Utils.escapeHtml(primaryTool)}</span>
            </span>
          </div>
          <div class="fc-file-actions">
            <button class="btn btn-xs btn-success fc-file-keep-all" data-file-path="${Utils.escapeHtml(filePath)}" data-session-id="${sessionId}" title="Keep all changes to this file">&#10003;</button>
            <button class="btn btn-xs btn-danger fc-file-revert-all" data-file-path="${Utils.escapeHtml(filePath)}" data-session-id="${sessionId}" title="Revert all changes to this file">&#8617;</button>
          </div>
        </div>
        ${
					isFileExpanded
						? `
          <div class="fc-file-hunks">
            ${changes.map((change, idx) => this._renderHunkListItem(change, idx, sessionId, fileKey)).join("")}
          </div>
        `
						: ""
				}
      </div>
    `;
	},

	/**
	 * Render a hunk list item (for file accordion)
	 */
	_renderHunkListItem(change, hunkIndex, sessionId, fileKey) {
		const additions = change.additions || 0;
		const deletions = change.deletions || 0;
		const toolType = this._getToolType(change.tool);

		return `
      <div class="fc-hunk-item"
           data-change-id="${change.id}"
           data-hunk-index="${hunkIndex}"
           data-session-id="${sessionId}"
           data-file-key="${Utils.escapeHtml(fileKey)}">
        <span class="fc-hunk-item-index">#${hunkIndex + 1}</span>
        <span class="fc-hunk-item-stats">
          ${additions ? `<span class="additions">+${additions}</span>` : ""}
          ${deletions ? `<span class="deletions">-${deletions}</span>` : ""}
        </span>
        <span class="fc-tool-badge ${toolType} small">${Utils.escapeHtml(change.tool || "unknown")}</span>
        <span class="fc-hunk-item-time">${Utils.formatTime(change.timestamp)}</span>
        <div class="fc-hunk-item-actions">
          <button class="btn btn-xs btn-success fc-hunk-keep" data-change-id="${change.id}" title="Keep">&#10003;</button>
          <button class="btn btn-xs btn-danger fc-hunk-revert" data-change-id="${change.id}" title="Revert">&#8617;</button>
        </div>
      </div>
    `;
	},

	/**
	 * Toggle file accordion expansion
	 */
	toggleFileAccordion(fileKey) {
		if (this._expandedFiles.has(fileKey)) {
			this._expandedFiles.delete(fileKey);
		} else {
			this._expandedFiles.add(fileKey);
		}
		this.renderSidebar();
	},

	/**
	 * Setup event handlers for sidebar
	 */
	_setupSidebarHandlers(container) {
		// Session header click - toggle expand
		container.querySelectorAll(".fc-session-header").forEach((header) => {
			header.addEventListener("click", (e) => {
				if (e.target.closest(".fc-session-actions")) return;
				const sessionId = header.dataset.sessionId;
				this.toggleSession(sessionId);
			});
		});

		// Session keep all
		container.querySelectorAll(".fc-session-keep").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const sessionId = btn.dataset.sessionId;
				this.keepAllInSession(sessionId);
			});
		});

		// Session revert all
		container.querySelectorAll(".fc-session-revert").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const sessionId = btn.dataset.sessionId;
				this.revertAllInSession(sessionId);
			});
		});

		// File accordion header click - toggle expand AND select file for viewing
		container.querySelectorAll(".fc-file-header").forEach((header) => {
			header.addEventListener("click", (e) => {
				if (e.target.closest(".fc-file-actions")) return;
				const fileKey = header.dataset.fileKey;
				const accordion = header.closest(".fc-file-accordion");
				const sessionId = accordion?.dataset.sessionId;
				const filePath = accordion?.dataset.filePath;

				// Toggle expansion
				this.toggleFileAccordion(fileKey);

				// Select file and load all its diffs
				if (sessionId && filePath) {
					this.selectFileForViewing(sessionId, filePath);
				}
			});
		});

		// File keep all (for a specific file)
		container.querySelectorAll(".fc-file-keep-all").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const filePath = btn.dataset.filePath;
				const sessionId = btn.dataset.sessionId;
				this.keepAllInFile(filePath, sessionId);
			});
		});

		// File revert all (for a specific file)
		container.querySelectorAll(".fc-file-revert-all").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const filePath = btn.dataset.filePath;
				const sessionId = btn.dataset.sessionId;
				this.revertAllInFile(filePath, sessionId);
			});
		});

		// Hunk item click - scroll to hunk in diff viewer
		container.querySelectorAll(".fc-hunk-item").forEach((item) => {
			item.addEventListener("click", (e) => {
				if (e.target.closest(".fc-hunk-item-actions")) return;
				const changeId = item.dataset.changeId;
				const hunkIndex = parseInt(item.dataset.hunkIndex, 10);
				const fileKey = item.dataset.fileKey;

				// If this file is already selected, just scroll to the hunk
				if (this._selectedFileKey === fileKey) {
					this._scrollToHunk(changeId, hunkIndex);
				} else {
					// Otherwise, select the file first and then scroll after diffs load
					const accordion = item.closest(".fc-file-accordion");
					const sessionId = accordion?.dataset.sessionId;
					const filePath = accordion?.dataset.filePath;
					if (sessionId && filePath) {
						this._pendingScrollToHunk = { changeId, hunkIndex };
						this.selectFileForViewing(sessionId, filePath);
					}
				}
			});
		});

		// Hunk keep (in sidebar)
		container.querySelectorAll(".fc-hunk-item .fc-hunk-keep").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.keepChange(btn.dataset.changeId);
			});
		});

		// Hunk revert (in sidebar)
		container
			.querySelectorAll(".fc-hunk-item .fc-hunk-revert")
			.forEach((btn) => {
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					this.revertChange(btn.dataset.changeId);
				});
			});

		// Archive toggle
		const archiveToggle = document.getElementById("fc-archive-toggle");
		if (archiveToggle) {
			archiveToggle.addEventListener("click", () => {
				// Navigate to archived view
				if (typeof Router !== "undefined") {
					Router.navigate("archived");
				}
			});
		}
	},

	/**
	 * Select a file for viewing - loads ALL changes/diffs for that file
	 */
	selectFileForViewing(sessionId, filePath) {
		const fileKey = `${sessionId}:${filePath}`;

		// If already selected, don't reload
		if (this._selectedFileKey === fileKey && this._currentDiffs.length > 0) {
			return;
		}

		// Get all changes for this file
		const changes = this._getFileChanges().filter(
			(c) =>
				c.filePath === filePath &&
				c.sessionId === sessionId &&
				c.status === "pending",
		);

		if (changes.length === 0) {
			this.renderEmptyDiff();
			return;
		}

		// Set selected file state
		this._selectedFileKey = fileKey;
		this._selectedFile = { sessionId, filePath, changes };
		this._currentDiffs = [];
		this._pendingDiffLoads = changes.length;

		// Update sidebar to show selection
		this.renderSidebar();

		// Show loading state
		this.renderDiffLoading();

		// Load diffs for all changes
		changes.forEach((change) => {
			if (this._diffCache.has(change.id)) {
				// Use cached diff
				this._currentDiffs.push({
					changeId: change.id,
					change: change,
					diff: this._diffCache.get(change.id),
				});
				this._pendingDiffLoads--;
				this._checkAllDiffsLoaded();
			} else {
				// Request diff from backend
				if (typeof API !== "undefined" && API.getDiff) {
					API.getDiff(change.id);
				}
			}
		});
	},

	/**
	 * Check if all diffs are loaded and render if so
	 */
	_checkAllDiffsLoaded() {
		if (this._pendingDiffLoads <= 0) {
			// Sort diffs by change order (timestamp or index)
			this._currentDiffs.sort((a, b) => {
				const timeA = new Date(a.change.timestamp || 0).getTime();
				const timeB = new Date(b.change.timestamp || 0).getTime();
				return timeA - timeB;
			});
			this.renderDiff();

			// Handle pending scroll if any
			if (this._pendingScrollToHunk) {
				const { changeId, hunkIndex } = this._pendingScrollToHunk;
				this._pendingScrollToHunk = null;
				setTimeout(() => this._scrollToHunk(changeId, hunkIndex), 100);
			}
		}
	},

	/**
	 * Update archive count
	 */
	_updateArchiveCount() {
		const countEl = document.getElementById("fc-archive-count");
		if (countEl && typeof State !== "undefined") {
			const count = (State.archivedChanges || []).length;
			countEl.textContent = count.toString();
		}
	},

	// ==========================================================================
	// Session/File Actions
	// ==========================================================================

	/**
	 * Toggle session accordion
	 */
	toggleSession(sessionId) {
		if (this._expandedSessions.has(sessionId)) {
			this._expandedSessions.delete(sessionId);
		} else {
			this._expandedSessions.add(sessionId);
		}
		this.renderSidebar();
	},
};

window.FcSessionListMixin = FcSessionListMixin;
