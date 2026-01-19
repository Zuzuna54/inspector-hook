/**
 * File Changes View - Complete Redesign
 * Sidebar + Full-Width Diff (VS Code Source Control style)
 * Features: Session accordions, per-hunk operations, inline editing, custom modals
 */

const FileChangesView = {
	// ==========================================================================
	// State
	// ==========================================================================

	_subscriptions: [],

	// UI State
	_expandedSessions: new Set(),
	_expandedFiles: new Set(), // filePath keys for expanded file accordions
	_selectedFileKey: null, // "sessionId:filePath" - the currently selected file
	_selectedFile: null, // { sessionId, filePath, changes: [...] } - all changes for selected file
	_viewMode: "unified", // 'unified' | 'split'

	// Diff State - now tracks multiple diffs for a file
	_currentDiffs: [], // Array of diff objects for all changes in selected file
	_diffCache: new Map(), // changeId -> diff object
	_pendingDiffLoads: 0, // Counter for pending diff loads

	// Edit State
	_isEditMode: false, // Page-level edit mode (all added lines editable)
	_editedContent: new Map(), // changeId -> modified afterContent
	_originalContent: new Map(), // changeId -> original afterContent (for reset/cancel)

	// Scroll State
	_pendingScrollToHunk: null, // { changeId, hunkIndex } to scroll to after diff renders

	// ==========================================================================
	// Initialization
	// ==========================================================================

	/**
	 * Initialize the view
	 */
	init() {
		this._setupSubscriptions();
		this.renderSidebar();
		this.renderEmptyDiff();

		// Request initial data
		if (typeof API !== "undefined" && API.getFileChanges) {
			API.getFileChanges();
		}
	},

	/**
	 * Setup state subscriptions
	 */
	_setupSubscriptions() {
		if (typeof State !== "undefined" && State.subscribe) {
			this._subscriptions.push(
				State.subscribe("fileChanges", () => this.renderSidebar()),
				State.subscribe("sessions", () => this.renderSidebar()),
				State.subscribe("archivedChanges", () => this._updateArchiveCount()),
			);
		}
	},

	/**
	 * Cleanup subscriptions when view is deactivated
	 */
	cleanup() {
		this._subscriptions.forEach((unsub) => {
			if (typeof unsub === "function") unsub();
		});
		this._subscriptions = [];
		this._expandedSessions.clear();
		this._expandedFiles.clear();
		this._selectedFileKey = null;
		this._selectedFile = null;
		this._currentDiffs = [];
		this._diffCache.clear();
		this._pendingDiffLoads = 0;
		this._isEditMode = false;
		this._editedContent.clear();
		this._originalContent.clear();
		this._pendingScrollToHunk = null;
	},

	// ==========================================================================
	// Data Helpers
	// ==========================================================================

	/**
	 * Get file changes from state
	 */
	_getFileChanges() {
		return typeof State !== "undefined" && State.fileChanges
			? State.fileChanges
			: [];
	},

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
	 * Get session display name
	 */
	_getSessionName(session) {
		if (session.name) return session.name;
		if (session.metadata?.projectName) return session.metadata.projectName;
		if (session.id) return session.id.slice(0, 8) + "...";
		return "Unknown Session";
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
				const projectName =
					session.metadata?.projectName || session.metadata?.cwd || "";
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
	 * Keep all changes in a specific file
	 */
	keepAllInFile(filePath, sessionId) {
		const changes = this._getFileChanges().filter(
			(c) =>
				c.filePath === filePath &&
				c.sessionId === sessionId &&
				c.status === "pending",
		);

		if (changes.length === 0) return;

		this._showConfirmModal({
			title: "Keep All Changes",
			message: `Keep all ${changes.length} change${changes.length !== 1 ? "s" : ""} to "${Utils.getFileName(filePath)}"?`,
			confirmText: "Keep All",
			confirmClass: "btn-success",
			onConfirm: () => {
				changes.forEach((c) => {
					if (typeof API !== "undefined" && API.keepChange) {
						API.keepChange(c.id);
					}
				});
			},
		});
	},

	/**
	 * Revert all changes in a specific file
	 */
	revertAllInFile(filePath, sessionId) {
		const changes = this._getFileChanges().filter(
			(c) =>
				c.filePath === filePath &&
				c.sessionId === sessionId &&
				c.status === "pending",
		);

		if (changes.length === 0) return;

		this._showConfirmModal({
			title: "Revert All Changes",
			message: `Revert all ${changes.length} change${changes.length !== 1 ? "s" : ""} to "${Utils.getFileName(filePath)}"? This will restore the original content.`,
			confirmText: "Revert All",
			confirmClass: "btn-danger",
			onConfirm: () => {
				changes.forEach((c) => {
					if (typeof API !== "undefined" && API.revertChange) {
						API.revertChange(c.id);
					}
				});
			},
		});
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

	/**
	 * Handle diff result from API - supports multi-diff loading
	 */
	handleDiffResult(payload) {
		if (!payload || !payload.changeId) return;

		const changeId = payload.changeId;

		// Cache the diff
		this._diffCache.set(changeId, payload);

		// Store original content for reset capability
		if (!this._originalContent.has(changeId) && payload.afterContent) {
			this._originalContent.set(changeId, payload.afterContent);
		}

		// Check if this diff belongs to the currently selected file
		if (this._selectedFile) {
			const change = this._selectedFile.changes?.find((c) => c.id === changeId);
			if (change) {
				// Add to current diffs
				this._currentDiffs.push({
					changeId: changeId,
					change: change,
					diff: payload,
				});
				this._pendingDiffLoads--;
				this._checkAllDiffsLoaded();
			}
		}
	},

	// ==========================================================================
	// Diff Rendering
	// ==========================================================================

	/**
	 * Render empty diff state
	 */
	renderEmptyDiff() {
		const container = document.getElementById("fc-diff-container");
		const toolbar = document.getElementById("fc-toolbar");
		if (!container) return;

		toolbar.innerHTML = "";
		container.innerHTML = `
      <div class="fc-empty-state">
        <div class="fc-empty-icon">&#128196;</div>
        <div class="fc-empty-title">Select a file to view changes</div>
        <div class="fc-empty-tips">
          <p><strong>Quick tips:</strong></p>
          <ul>
            <li>Click a session to expand and see files</li>
            <li>Click a file to view its diff</li>
            <li>Use Keep/Revert to manage changes</li>
            <li>Edit hunks inline before keeping</li>
          </ul>
        </div>
      </div>
    `;
	},

	/**
	 * Render loading state
	 */
	renderDiffLoading() {
		const container = document.getElementById("fc-diff-container");
		if (!container) return;

		container.innerHTML = '<div class="fc-diff-loading">Loading diff...</div>';
	},

	/**
	 * Render error state with retry button
	 */
	renderDiffError(message = "Failed to load diff") {
		const container = document.getElementById("fc-diff-container");
		const toolbar = document.getElementById("fc-toolbar");
		if (!container) return;

		toolbar.innerHTML = "";
		container.innerHTML = `
      <div class="fc-diff-error">
        <div class="fc-diff-error-icon">&#9888;</div>
        <div class="fc-diff-error-message">${Utils.escapeHtml(message)}</div>
        <button class="btn btn-sm fc-diff-error-retry">Retry</button>
      </div>
    `;

		// Setup retry handler
		container
			.querySelector(".fc-diff-error-retry")
			?.addEventListener("click", () => {
				if (this._selectedFile) {
					// Clear cache and reload
					this._selectedFile.changes?.forEach((c) =>
						this._diffCache.delete(c.id),
					);
					this.selectFileForViewing(
						this._selectedFile.sessionId,
						this._selectedFile.filePath,
					);
				}
			});
	},

	/**
	 * Handle diff error from API
	 */
	handleDiffError(error) {
		this._pendingDiffLoads--;
		// If all pending loads are done but with errors, show error
		if (this._pendingDiffLoads <= 0 && this._currentDiffs.length === 0) {
			this.renderDiffError(
				error?.message || "Failed to load diff. Please try again.",
			);
		} else {
			this._checkAllDiffsLoaded();
		}
	},

	/**
	 * Render the diff panel - shows ALL changes/hunks for the selected file
	 */
	renderDiff() {
		const container = document.getElementById("fc-diff-container");
		const toolbar = document.getElementById("fc-toolbar");

		if (!container || !this._selectedFile || this._currentDiffs.length === 0) {
			this.renderEmptyDiff();
			return;
		}

		const { filePath, changes } = this._selectedFile;

		// Calculate total stats across all changes
		let totalAdditions = 0;
		let totalDeletions = 0;
		let totalHunks = 0;
		this._currentDiffs.forEach(({ diff }) => {
			totalAdditions += diff.additions || 0;
			totalDeletions += diff.deletions || 0;
			totalHunks += (diff.hunks || []).length;
		});

		// Render toolbar - show different actions based on edit mode
		const editModeActions = this._isEditMode
			? `
      <button class="btn btn-xs btn-secondary fc-edit-cancel" title="Cancel editing and discard changes">Cancel</button>
      <button class="btn btn-xs btn-primary fc-edit-done" title="Done editing">Done</button>
    `
			: `
      <button class="btn btn-xs fc-toolbar-edit" title="Edit changes">Edit</button>
      <button class="btn btn-xs fc-open-file" title="Open in Editor">Open</button>
      <button class="btn btn-xs btn-success fc-toolbar-keep-all" title="Keep all changes">Keep All</button>
      <button class="btn btn-xs btn-danger fc-toolbar-revert-all" title="Revert all changes">Revert All</button>
    `;

		toolbar.innerHTML = `
      <span class="fc-toolbar-path" title="${Utils.escapeHtml(filePath)}">${Utils.escapeHtml(filePath)}</span>
      <div class="fc-toolbar-stats">
        <span class="fc-stat-add">+${totalAdditions}</span>
        <span class="fc-stat-del">-${totalDeletions}</span>
        <span class="fc-stat-hunks">${totalHunks} hunk${totalHunks !== 1 ? "s" : ""}</span>
        <span class="fc-stat-changes">${changes.length} change${changes.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="fc-view-toggle ${this._isEditMode ? "disabled" : ""}">
        <button class="${this._viewMode === "unified" ? "active" : ""}" data-mode="unified" ${this._isEditMode ? "disabled" : ""}>Unified</button>
        <button class="${this._viewMode === "split" ? "active" : ""}" data-mode="split" ${this._isEditMode ? "disabled" : ""}>Split</button>
      </div>
      <div class="fc-toolbar-actions">
        ${editModeActions}
      </div>
    `;

		// Render diff content - all changes combined
		if (totalHunks === 0) {
			container.innerHTML =
				'<div class="fc-empty-state"><div class="fc-empty-title">No changes detected</div></div>';
		} else {
			container.innerHTML =
				this._viewMode === "unified"
					? this._renderAllChangesUnified(filePath)
					: this._renderAllChangesSplit(filePath);
		}

		this._setupDiffHandlers();
	},

	/**
	 * Render all changes in unified view
	 */
	_renderAllChangesUnified(filePath) {
		const language = Utils.detectLanguage(filePath, "");

		const changesHtml = this._currentDiffs
			.map(({ changeId, change, diff }, changeIndex) => {
				const hunks = diff.hunks || [];

				return hunks
					.map((hunk, hunkIndex) => {
						// Page-level edit mode - all hunks editable when _isEditMode is true
						return this._renderHunkCard(
							hunk,
							changeId,
							hunkIndex,
							change,
							language,
							this._isEditMode,
						);
					})
					.join("");
			})
			.join("");

		return `<div class="fc-diff-unified fc-diff-all-changes ${this._isEditMode ? "edit-mode" : ""}">${changesHtml}</div>`;
	},

	/**
	 * Render all changes in split view
	 */
	_renderAllChangesSplit(filePath) {
		const language = Utils.detectLanguage(filePath, "");

		const changesHtml = this._currentDiffs
			.map(({ changeId, change, diff }) => {
				const hunks = diff.hunks || [];

				return hunks
					.map((hunk, hunkIndex) => {
						return this._renderSplitHunkRow(
							hunk,
							changeId,
							hunkIndex,
							change,
							language,
						);
					})
					.join("");
			})
			.join("");

		return `
      <div class="fc-diff-split">
        <div class="fc-split-headers">
          <div class="fc-diff-split-header">Before</div>
          <div class="fc-diff-split-header">After</div>
        </div>
        ${changesHtml}
      </div>
    `;
	},

	/**
	 * Render a single hunk card (unified view)
	 */
	_renderHunkCard(hunk, changeId, hunkIndex, change, language, isEditing) {
		const oldStart = hunk.oldStart || 1;
		const oldLines = hunk.oldLines || 0;
		const newStart = hunk.newStart || 1;
		const newLines = hunk.newLines || 0;
		const toolType = this._getToolType(change.tool);

		// Render lines
		let oldLineNum = oldStart;
		let newLineNum = newStart;

		const linesHtml = (hunk.lines || [])
			.map((line, lineIdx) => {
				const type = line.type || "context";
				const isEditable = type === "added" && isEditing;
				const content = line.content || "";

				let displayNum;
				if (type === "removed") {
					displayNum = oldLineNum++;
				} else if (type === "added") {
					displayNum = newLineNum++;
				} else {
					displayNum = newLineNum;
					oldLineNum++;
					newLineNum++;
				}

				return this._renderDiffLineWithNumbers(
					content,
					displayNum,
					displayNum,
					type,
					language,
					hunkIndex,
					isEditable,
					lineIdx,
				);
			})
			.join("");

		return `
      <div class="fc-hunk-card ${isEditing ? "editing" : ""}" data-change-id="${changeId}" data-hunk-index="${hunkIndex}">
        <div class="fc-hunk-header">
          <span class="fc-hunk-info">@@ -${oldStart},${oldLines} +${newStart},${newLines} @@</span>
          <span class="fc-tool-badge ${toolType} small">${Utils.escapeHtml(change.tool || "unknown")}</span>
          <span class="fc-hunk-time">${Utils.formatTime(change.timestamp)}</span>
          <div class="fc-hunk-actions">
            <button class="btn btn-xs btn-success fc-hunk-keep" data-change-id="${changeId}" title="Keep">Keep</button>
            <button class="btn btn-xs btn-danger fc-hunk-revert" data-change-id="${changeId}" title="Revert">Revert</button>
          </div>
        </div>
        <div class="fc-hunk-lines">${linesHtml}</div>
      </div>
    `;
	},

	/**
	 * Render a split hunk row
	 */
	_renderSplitHunkRow(hunk, changeId, hunkIndex, change, language) {
		const oldStart = hunk.oldStart || 1;
		const oldLines = hunk.oldLines || 0;
		const newStart = hunk.newStart || 1;
		const newLines = hunk.newLines || 0;
		const toolType = this._getToolType(change.tool);

		return `
      <div class="fc-split-hunk-row" data-change-id="${changeId}" data-hunk-index="${hunkIndex}">
        <div class="fc-split-hunk-header">
          <span class="fc-hunk-info">@@ -${oldStart},${oldLines} +${newStart},${newLines} @@</span>
          <span class="fc-tool-badge ${toolType} small">${Utils.escapeHtml(change.tool || "unknown")}</span>
          <div class="fc-hunk-actions">
            <button class="btn btn-xs btn-success fc-hunk-keep" data-change-id="${changeId}" title="Keep">Keep</button>
            <button class="btn btn-xs btn-danger fc-hunk-revert" data-change-id="${changeId}" title="Revert">Revert</button>
          </div>
        </div>
        <div class="fc-split-hunk-content">
          <div class="fc-diff-split-pane">
            ${this._renderSplitPane(hunk, "before", language)}
          </div>
          <div class="fc-diff-split-pane">
            ${this._renderSplitPane(hunk, "after", language)}
          </div>
        </div>
      </div>
    `;
	},

	/**
	 * Render a split pane (before or after)
	 */
	_renderSplitPane(hunk, side, language) {
		const lines = hunk.lines || [];
		const oldStart = hunk.oldStart || 1;
		const newStart = hunk.newStart || 1;

		let oldLineNum = oldStart;
		let newLineNum = newStart;

		const linesHtml = lines
			.map((line) => {
				const type = line.type || "context";

				if (type === "removed") {
					if (side === "before") {
						const content = line.content || "";
						const escaped = Utils.escapeHtml(content);
						const highlighted = this._applySyntaxHighlighting(
							escaped,
							language,
						);
						const result = `<div class="fc-line removed"><span class="fc-line-num">${oldLineNum}</span><span class="fc-line-content">${highlighted}</span></div>`;
						oldLineNum++;
						return result;
					}
					oldLineNum++;
					return "";
				} else if (type === "added") {
					if (side === "after") {
						const content = line.content || "";
						const escaped = Utils.escapeHtml(content);
						const highlighted = this._applySyntaxHighlighting(
							escaped,
							language,
						);
						const result = `<div class="fc-line added"><span class="fc-line-num">${newLineNum}</span><span class="fc-line-content">${highlighted}</span></div>`;
						newLineNum++;
						return result;
					}
					newLineNum++;
					return "";
				} else {
					// Context line - show on both sides
					const content = line.content || "";
					const escaped = Utils.escapeHtml(content);
					const highlighted = this._applySyntaxHighlighting(escaped, language);
					const lineNum = side === "before" ? oldLineNum : newLineNum;
					const result = `<div class="fc-line context"><span class="fc-line-num">${lineNum}</span><span class="fc-line-content">${highlighted}</span></div>`;
					oldLineNum++;
					newLineNum++;
					return result;
				}
			})
			.join("");

		return `<div class="fc-hunk-lines">${linesHtml}</div>`;
	},

	/**
	 * Scroll the diff viewer to a specific hunk by changeId and hunkIndex
	 */
	_scrollToHunk(changeId, hunkIndex) {
		const container = document.getElementById("fc-diff-container");
		if (!container) return;

		// Find the hunk element by data attributes (changeId + hunkIndex)
		const hunkEl =
			container.querySelector(
				`[data-change-id="${changeId}"][data-hunk-index="${hunkIndex}"]`,
			) ||
			container.querySelector(`.fc-hunk-card[data-change-id="${changeId}"]`) ||
			container.querySelector(
				`.fc-split-hunk-row[data-change-id="${changeId}"]`,
			);

		if (hunkEl) {
			// Scroll to the hunk with some offset for better visibility
			hunkEl.scrollIntoView({ behavior: "smooth", block: "start" });

			// Highlight the hunk briefly
			hunkEl.classList.add("fc-hunk-highlight");
			setTimeout(() => {
				hunkEl.classList.remove("fc-hunk-highlight");
			}, 2000);
		}
	},

	/**
	 * Render unified diff view - shows full file with changes highlighted
	 */
	_renderUnifiedDiff(diff, filePath) {
		const language = Utils.detectLanguage(filePath, diff.afterContent || "");
		const hunks = diff.hunks || [];

		// If we have full file content, render the complete file with hunks highlighted
		if (diff.beforeContent || diff.afterContent) {
			return this._renderFullFileDiff(diff, language);
		}

		// Fallback to hunk-only view
		return `
      <div class="fc-diff-unified">
        ${hunks.map((hunk, idx) => this._renderHunk(hunk, idx, language)).join("")}
      </div>
    `;
	},

	/**
	 * Render full file diff with all lines and changes highlighted
	 */
	_renderFullFileDiff(diff, language) {
		const beforeLines = (diff.beforeContent || "").split("\n");
		const afterLines = (diff.afterContent || "").split("\n");
		const hunks = diff.hunks || [];

		// Build a map of line changes from hunks for quick lookup
		const lineChanges = this._buildLineChangeMap(hunks);

		// Render the full "after" file with deletions shown inline
		let html = '<div class="fc-diff-unified fc-diff-full-file">';

		let oldLineNum = 1;
		let newLineNum = 1;
		const hunkIdx = 0;

		// Process hunks in order
		for (let h = 0; h < hunks.length; h++) {
			const hunk = hunks[h];
			const isEditing = this._isEditMode;

			// Add context lines before this hunk (from before content)
			const contextBefore = Math.max(0, (hunk.oldStart || 1) - oldLineNum);
			for (
				let i = 0;
				i < contextBefore && oldLineNum - 1 < beforeLines.length;
				i++
			) {
				const content = beforeLines[oldLineNum - 1] || "";
				html += this._renderDiffLineWithNumbers(
					content,
					oldLineNum,
					newLineNum,
					"context",
					language,
					h,
					false,
				);
				oldLineNum++;
				newLineNum++;
			}

			// Render hunk header
			html += `
        <div class="fc-hunk-header-inline" data-hunk-index="${h}">
          <span class="fc-hunk-info">@@ -${hunk.oldStart || 0},${hunk.oldLines || 0} +${hunk.newStart || 0},${hunk.newLines || 0} @@</span>
          <div class="fc-hunk-actions">
            <button class="btn btn-xs btn-success fc-hunk-keep" data-hunk-index="${h}" title="Keep">Keep</button>
            <button class="btn btn-xs btn-danger fc-hunk-revert" data-hunk-index="${h}" title="Revert">Revert</button>
          </div>
        </div>
      `;

			// Render hunk lines with proper line numbers
			const lines = hunk.lines || [];
			let hunkOldLine = hunk.oldStart || 1;
			let hunkNewLine = hunk.newStart || 1;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const type = line.type || "context";
				const content = line.content || "";
				const isEditable = type === "added" && isEditing;

				let displayOld = "";
				let displayNew = "";

				if (type === "removed") {
					displayOld = hunkOldLine;
					hunkOldLine++;
				} else if (type === "added") {
					displayNew = hunkNewLine;
					hunkNewLine++;
				} else {
					displayOld = hunkOldLine;
					displayNew = hunkNewLine;
					hunkOldLine++;
					hunkNewLine++;
				}

				html += this._renderDiffLineWithNumbers(
					content,
					displayOld,
					displayNew,
					type,
					language,
					h,
					isEditable,
					i,
				);
			}

			// Update line counters
			oldLineNum = hunkOldLine;
			newLineNum = hunkNewLine;
		}

		// Add remaining context lines after last hunk
		while (newLineNum - 1 < afterLines.length) {
			const content = afterLines[newLineNum - 1] || "";
			html += this._renderDiffLineWithNumbers(
				content,
				oldLineNum,
				newLineNum,
				"context",
				language,
				hunks.length,
				false,
			);
			oldLineNum++;
			newLineNum++;
		}

		html += "</div>";
		return html;
	},

	/**
	 * Build a map of line changes from hunks
	 */
	_buildLineChangeMap(hunks) {
		const map = new Map();
		for (const hunk of hunks) {
			let lineNum = hunk.newStart || 1;
			for (const line of hunk.lines || []) {
				if (line.type === "added") {
					map.set(lineNum, { type: "added", content: line.content });
					lineNum++;
				} else if (line.type === "context") {
					lineNum++;
				}
			}
		}
		return map;
	},

	/**
	 * Render a diff line with a single line number column (unified view style)
	 */
	_renderDiffLineWithNumbers(
		content,
		oldNum,
		newNum,
		type,
		language,
		hunkIndex,
		isEditable,
		lineIdx = 0,
	) {
		// Escape HTML in content, then apply syntax highlighting
		const escapedContent = Utils.escapeHtml(content);
		const highlightedContent = this._applySyntaxHighlighting(
			escapedContent,
			language,
		);

		// For unified view, show single line number based on line type
		// - removed lines: show old line number
		// - added lines: show new line number
		// - context lines: show new line number (both are same in context)
		const lineNum = type === "removed" ? oldNum : newNum;

		return `<div class="fc-line ${type} ${isEditable ? "editing" : ""}" data-line-idx="${lineIdx}" data-hunk-index="${hunkIndex}"><span class="fc-line-num">${lineNum}</span><span class="fc-line-content" ${isEditable ? 'contenteditable="true"' : ""}>${highlightedContent}</span></div>`;
	},

	/**
	 * Apply syntax highlighting to already-escaped content
	 * This is a language-agnostic method that highlights common programming patterns
	 */
	_applySyntaxHighlighting(escapedContent, language) {
		if (!escapedContent || language === "plaintext") return escapedContent;

		// Simple token-based highlighting for common patterns
		let result = escapedContent;

		// Keywords (language agnostic common ones)
		const keywords =
			/\b(const|let|var|function|class|return|if|else|for|while|import|export|from|default|async|await|try|catch|throw|new|this|true|false|null|undefined|type|interface|enum|extends|implements|public|private|protected|static|readonly|abstract|override)\b/g;
		result = result.replace(keywords, '<span class="token keyword">$1</span>');

		// Strings (already escaped, so &quot; instead of ")
		result = result.replace(
			/(&quot;[^&]*&quot;|&#39;[^&]*&#39;|`[^`]*`)/g,
			'<span class="token string">$1</span>',
		);

		// Numbers
		result = result.replace(
			/\b(\d+\.?\d*)\b/g,
			'<span class="token number">$1</span>',
		);

		// Comments (single line // and # style)
		result = result.replace(
			/(\/\/.*$|#.*$)/gm,
			'<span class="token comment">$1</span>',
		);

		// Function calls (word followed by opening paren)
		result = result.replace(
			/\b([a-zA-Z_]\w*)\s*(?=\()/g,
			'<span class="token function">$1</span>',
		);

		// Types (PascalCase words that aren't already wrapped)
		result = result.replace(
			/(?<!<span[^>]*>)\b([A-Z][a-zA-Z0-9]*)\b(?![^<]*<\/span>)/g,
			'<span class="token type">$1</span>',
		);

		return result;
	},

	/**
	 * Render split diff view
	 */
	_renderSplitDiff(diff, filePath) {
		const language = Utils.detectLanguage(filePath, diff.afterContent || "");
		const hunks = diff.hunks || [];

		// Render hunks with shared header across both panes
		const hunkRows = hunks
			.map((hunk, idx) => {
				const oldStart = hunk.oldStart || 1;
				const oldLines = hunk.oldLines || 0;
				const newStart = hunk.newStart || 1;
				const newLines = hunk.newLines || 0;

				return `
        <div class="fc-split-hunk-row" data-hunk-index="${idx}">
          <div class="fc-split-hunk-header">
            <span class="fc-hunk-info">@@ -${oldStart},${oldLines} +${newStart},${newLines} @@</span>
            <div class="fc-hunk-actions">
              <button class="btn btn-xs fc-hunk-edit" data-hunk-index="${idx}" title="Edit">Edit</button>
              <button class="btn btn-xs btn-success fc-hunk-keep" data-hunk-index="${idx}" title="Keep">Keep</button>
              <button class="btn btn-xs btn-danger fc-hunk-revert" data-hunk-index="${idx}" title="Revert">Revert</button>
            </div>
          </div>
          <div class="fc-split-hunk-content">
            <div class="fc-diff-split-pane">
              ${this._renderSplitHunkPane(hunk, idx, "before", language)}
            </div>
            <div class="fc-diff-split-pane">
              ${this._renderSplitHunkPane(hunk, idx, "after", language)}
            </div>
          </div>
        </div>
      `;
			})
			.join("");

		return `
      <div class="fc-diff-split">
        <div class="fc-split-headers">
          <div class="fc-diff-split-header">Before</div>
          <div class="fc-diff-split-header">After</div>
        </div>
        ${hunkRows}
      </div>
    `;
	},

	/**
	 * Render a single hunk (unified) - fallback when no full file content
	 */
	_renderHunk(hunk, index, language) {
		const isEditing = this._isEditMode;
		const oldStart = hunk.oldStart || 1;
		const oldLines = hunk.oldLines || 0;
		const newStart = hunk.newStart || 1;
		const newLines = hunk.newLines || 0;

		// Compute line numbers for each line
		let oldLineNum = oldStart;
		let newLineNum = newStart;

		const renderedLines = (hunk.lines || [])
			.map((line, lineIdx) => {
				const type = line.type || "context";
				const isEditable = type === "added" && isEditing;
				const content = line.content || "";

				let displayOld = "";
				let displayNew = "";

				if (type === "removed") {
					displayOld = oldLineNum++;
				} else if (type === "added") {
					displayNew = newLineNum++;
				} else {
					displayOld = oldLineNum++;
					displayNew = newLineNum++;
				}

				return this._renderDiffLineWithNumbers(
					content,
					displayOld,
					displayNew,
					type,
					language,
					index,
					isEditable,
					lineIdx,
				);
			})
			.join("");

		return `
      <div class="fc-hunk" data-hunk-index="${index}">
        <div class="fc-hunk-header">
          <span class="fc-hunk-info">@@ -${oldStart},${oldLines} +${newStart},${newLines} @@</span>
          <div class="fc-hunk-actions">
            <button class="btn btn-xs btn-success fc-hunk-keep" data-hunk-index="${index}" title="Keep this hunk">Keep</button>
            <button class="btn btn-xs btn-danger fc-hunk-revert" data-hunk-index="${index}" title="Revert this hunk">Revert</button>
          </div>
        </div>
        <div class="fc-hunk-lines">
          ${renderedLines}
        </div>
      </div>
    `;
	},

	/**
	 * Render a split pane hunk
	 */
	_renderSplitHunkPane(hunk, index, side, language) {
		const lines = hunk.lines || [];
		const oldStart = hunk.oldStart || 1;
		const newStart = hunk.newStart || 1;

		// Compute line numbers while filtering
		let oldLineNum = oldStart;
		let newLineNum = newStart;

		const renderedLines = lines
			.map((line) => {
				const type = line.type || "context";

				if (type === "removed") {
					if (side === "before") {
						const content = line.content || "";
						const escapedContent = Utils.escapeHtml(content);
						const highlighted = this._applySyntaxHighlighting(
							escapedContent,
							language,
						);
						const result = `
            <div class="fc-line removed">
              <span class="fc-line-num">${oldLineNum}</span>
              <span class="fc-line-content">${highlighted}</span>
            </div>
          `;
						oldLineNum++;
						return result;
					}
					oldLineNum++;
					return "";
				} else if (type === "added") {
					if (side === "after") {
						const content = line.content || "";
						const escapedContent = Utils.escapeHtml(content);
						const highlighted = this._applySyntaxHighlighting(
							escapedContent,
							language,
						);
						const result = `
            <div class="fc-line added">
              <span class="fc-line-num">${newLineNum}</span>
              <span class="fc-line-content">${highlighted}</span>
            </div>
          `;
						newLineNum++;
						return result;
					}
					newLineNum++;
					return "";
				} else {
					// Context line - show on both sides
					const content = line.content || "";
					const escapedContent = Utils.escapeHtml(content);
					const highlighted = this._applySyntaxHighlighting(
						escapedContent,
						language,
					);
					const lineNum = side === "before" ? oldLineNum : newLineNum;
					const result = `
          <div class="fc-line context">
            <span class="fc-line-num">${lineNum}</span>
            <span class="fc-line-content">${highlighted}</span>
          </div>
        `;
					oldLineNum++;
					newLineNum++;
					return result;
				}
			})
			.join("");

		return `
      <div class="fc-hunk" data-hunk-index="${index}">
        <div class="fc-hunk-lines">
          ${renderedLines}
        </div>
      </div>
    `;
	},

	/**
	 * Setup event handlers for diff panel
	 */
	_setupDiffHandlers() {
		const toolbar = document.getElementById("fc-toolbar");
		const container = document.getElementById("fc-diff-container");

		// View toggle (disabled in edit mode)
		toolbar?.querySelectorAll(".fc-view-toggle button").forEach((btn) => {
			btn.addEventListener("click", () => {
				if (this._isEditMode) return; // Don't allow mode switch while editing
				this._viewMode = btn.dataset.mode;
				this.renderDiff();
			});
		});

		// Toolbar Edit button - enter edit mode
		toolbar
			?.querySelector(".fc-toolbar-edit")
			?.addEventListener("click", () => {
				this.enterEditMode();
			});

		// Toolbar Cancel button - cancel editing and discard changes
		toolbar?.querySelector(".fc-edit-cancel")?.addEventListener("click", () => {
			this.cancelEditMode();
		});

		// Toolbar Done button - exit edit mode (changes already auto-saved)
		toolbar?.querySelector(".fc-edit-done")?.addEventListener("click", () => {
			this.exitEditMode();
		});

		// Open file in editor
		toolbar?.querySelector(".fc-open-file")?.addEventListener("click", () => {
			if (this._selectedFile && typeof API !== "undefined") {
				API.openFile(this._selectedFile.filePath);
			}
		});

		// Toolbar keep all - keeps all changes for this file
		toolbar
			?.querySelector(".fc-toolbar-keep-all")
			?.addEventListener("click", () => {
				if (this._selectedFile) {
					this.keepAllInFile(
						this._selectedFile.filePath,
						this._selectedFile.sessionId,
					);
				}
			});

		// Toolbar revert all - reverts all changes for this file
		toolbar
			?.querySelector(".fc-toolbar-revert-all")
			?.addEventListener("click", () => {
				if (this._selectedFile) {
					this.revertAllInFile(
						this._selectedFile.filePath,
						this._selectedFile.sessionId,
					);
				}
			});

		// Hunk keep buttons - keep the specific change
		container?.querySelectorAll(".fc-hunk-keep").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (this._isEditMode) return; // Don't allow keep while editing
				const changeId = btn.dataset.changeId;
				if (changeId) {
					this.keepChange(changeId);
				}
			});
		});

		// Hunk revert buttons - revert the specific change
		container?.querySelectorAll(".fc-hunk-revert").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (this._isEditMode) return; // Don't allow revert while editing
				const changeId = btn.dataset.changeId;
				if (changeId) {
					this.revertChange(changeId);
				}
			});
		});

		// Contenteditable blur handler for auto-save
		container
			?.querySelectorAll(".fc-line.editing .fc-line-content")
			.forEach((el) => {
				el.addEventListener("blur", () => {
					this._handleLineEdit(el);
				});
				// Escape key to cancel editing
				el.addEventListener("keydown", (e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						el.blur();
						this.cancelEditMode();
					}
				});
			});

		// Global Escape key to cancel edit mode
		if (this._isEditMode) {
			const escHandler = (e) => {
				if (e.key === "Escape") {
					this.cancelEditMode();
					document.removeEventListener("keydown", escHandler);
				}
			};
			document.addEventListener("keydown", escHandler);
		}
	},

	// ==========================================================================
	// Edit Mode (Page-level)
	// ==========================================================================

	/**
	 * Enter edit mode - makes all added lines editable across all changes
	 */
	enterEditMode() {
		if (!this._selectedFile) return;

		// Store original content for all current diffs if not already stored
		for (const diffEntry of this._currentDiffs) {
			if (diffEntry.diff && !this._originalContent.has(diffEntry.changeId)) {
				this._originalContent.set(
					diffEntry.changeId,
					diffEntry.diff.afterContent || "",
				);
			}
		}

		this._isEditMode = true;
		this.renderDiff();

		// Focus first editable line
		setTimeout(() => {
			const firstEditable = document.querySelector(
				".fc-line.editing .fc-line-content",
			);
			if (firstEditable) {
				firstEditable.focus();
			}
		}, 50);
	},

	/**
	 * Exit edit mode (keeps changes)
	 */
	exitEditMode() {
		this._isEditMode = false;
		this.renderDiff();
	},

	/**
	 * Cancel edit mode - discards all edits and restores original content
	 */
	cancelEditMode() {
		if (!this._selectedFile) return;

		// Restore original content for all changes
		for (const diffEntry of this._currentDiffs) {
			const changeId = diffEntry.changeId;
			const original = this._originalContent.get(changeId);

			if (original && diffEntry.diff) {
				// Clear edited content
				this._editedContent.delete(changeId);

				// Restore original
				diffEntry.diff.afterContent = original;

				// Clear cache so it will be re-fetched if needed
				this._diffCache.delete(changeId);

				// Send reset to backend
				if (typeof API !== "undefined" && API.updateChangeContent) {
					API.updateChangeContent(changeId, original);
				}
			}
		}

		this._isEditMode = false;
		this.renderDiff();
	},

	/**
	 * Handle line edit (auto-save on blur)
	 * @param {HTMLElement} lineEl - The line content element that was edited
	 */
	_handleLineEdit(lineEl) {
		if (!this._selectedFile || !this._isEditMode) return;

		// Get changeId from the hunk card containing this line
		const hunkCard = lineEl.closest(".fc-hunk-card");
		if (!hunkCard) return;

		const changeId = hunkCard.dataset.changeId;
		if (!changeId) return;

		// Find the diff data for this change from _currentDiffs
		const diffEntry = this._currentDiffs.find((d) => d.changeId === changeId);
		if (!diffEntry || !diffEntry.diff) return;

		const diff = diffEntry.diff;
		const lineHunkIndex = parseInt(
			lineEl.closest(".fc-line")?.dataset.hunkIndex || "0",
			10,
		);
		const lineIdx = parseInt(
			lineEl.closest(".fc-line")?.dataset.lineIdx || "0",
			10,
		);
		const newLineContent = lineEl.textContent || "";

		// Get the current after content (edited or original)
		const afterContent =
			this._editedContent.get(changeId) ||
			diff.afterContent ||
			this._originalContent.get(changeId) ||
			"";

		// Parse into lines
		const lines = afterContent.split("\n");
		const hunks = diff.hunks || [];

		// Find the actual line number in the file from hunk info
		if (lineHunkIndex < hunks.length) {
			const hunk = hunks[lineHunkIndex];
			let addedLineCount = 0;
			const hunkLines = hunk.lines || [];

			// Count added lines up to lineIdx to find the line number
			for (let i = 0; i <= lineIdx && i < hunkLines.length; i++) {
				const line = hunkLines[i];
				if (line.type === "added") {
					if (i === lineIdx) {
						// This is the line we edited - compute actual file line number
						const fileLineNum = (hunk.newStart || 1) + addedLineCount - 1;
						if (fileLineNum >= 0 && fileLineNum < lines.length) {
							lines[fileLineNum] = newLineContent;
						}
						break;
					}
					addedLineCount++;
				} else if (line.type === "context") {
					addedLineCount++;
				}
			}
		}

		// Reconstruct content and save
		const updatedContent = lines.join("\n");
		this._editedContent.set(changeId, updatedContent);

		// Send to backend
		if (typeof API !== "undefined" && API.updateChangeContent) {
			API.updateChangeContent(changeId, updatedContent);
		}
	},

	/**
	 * Reset all edits to original content (while staying in edit mode)
	 */
	resetAllEdits() {
		if (!this._selectedFile) return;

		// Restore original content for all changes
		for (const diffEntry of this._currentDiffs) {
			const changeId = diffEntry.changeId;
			const original = this._originalContent.get(changeId);

			if (original && diffEntry.diff) {
				// Clear edited content
				this._editedContent.delete(changeId);

				// Restore original
				diffEntry.diff.afterContent = original;

				// Clear cache
				this._diffCache.delete(changeId);

				// Send reset to backend
				if (typeof API !== "undefined" && API.updateChangeContent) {
					API.updateChangeContent(changeId, original);
				}
			}
		}

		this.renderDiff();
	},

	// ==========================================================================
	// Change Actions
	// ==========================================================================

	/**
	 * Keep a single change
	 */
	keepChange(changeId) {
		if (typeof API !== "undefined" && API.keepChange) {
			API.keepChange(changeId);
		}

		// Optimistic update - remove from current diffs if present
		this._removeFromCache(changeId);
		this._currentDiffs = this._currentDiffs.filter(
			(d) => d.changeId !== changeId,
		);

		// If this was the last change for the selected file, clear selection
		if (this._selectedFile) {
			this._selectedFile.changes = this._selectedFile.changes.filter(
				(c) => c.id !== changeId,
			);
			if (this._selectedFile.changes.length === 0) {
				this._selectedFile = null;
				this._selectedFileKey = null;
				this._currentDiffs = [];
				this.renderEmptyDiff();
				return;
			}
		}

		// Re-render if there are still changes
		if (this._currentDiffs.length > 0) {
			this.renderDiff();
		}
	},

	/**
	 * Revert a single change with confirmation
	 */
	revertChange(changeId) {
		const changes = this._getFileChanges();
		const change = changes.find((c) => c.id === changeId);
		if (!change) return;

		this._showConfirmModal({
			title: "Revert Change",
			message: `Are you sure you want to revert changes to "${Utils.getFileName(change.filePath)}"? This will restore the original file content.`,
			confirmText: "Revert",
			confirmClass: "btn-danger",
			onConfirm: () => {
				if (typeof API !== "undefined" && API.revertChange) {
					API.revertChange(changeId);
				}

				// Optimistic update - remove from current diffs if present
				this._removeFromCache(changeId);
				this._currentDiffs = this._currentDiffs.filter(
					(d) => d.changeId !== changeId,
				);

				// If this was the last change for the selected file, clear selection
				if (this._selectedFile) {
					this._selectedFile.changes = this._selectedFile.changes.filter(
						(c) => c.id !== changeId,
					);
					if (this._selectedFile.changes.length === 0) {
						this._selectedFile = null;
						this._selectedFileKey = null;
						this._currentDiffs = [];
						this.renderEmptyDiff();
						return;
					}
				}

				// Re-render if there are still changes
				if (this._currentDiffs.length > 0) {
					this.renderDiff();
				}
			},
		});
	},

	/**
	 * Keep all changes in a session
	 */
	keepAllInSession(sessionId) {
		const changes = this._getFileChanges().filter(
			(c) => c.sessionId === sessionId && c.status === "pending",
		);
		if (changes.length === 0) return;

		this._showConfirmModal({
			title: "Keep All Changes",
			message: `Keep all ${changes.length} change${changes.length !== 1 ? "s" : ""} in this session?`,
			confirmText: "Keep All",
			confirmClass: "btn-success",
			onConfirm: () => {
				const changeIds = changes.map((c) => c.id);

				changes.forEach((c) => {
					if (typeof API !== "undefined" && API.keepChange) {
						API.keepChange(c.id);
					}
					this._removeFromCache(c.id);
				});

				// Clear current diffs if any belong to this session
				this._currentDiffs = this._currentDiffs.filter(
					(d) => !changeIds.includes(d.changeId),
				);

				// If selected file belongs to this session, clear it
				if (this._selectedFile && this._selectedFile.sessionId === sessionId) {
					this._selectedFile = null;
					this._selectedFileKey = null;
					this._currentDiffs = [];
					this.renderEmptyDiff();
				}
			},
		});
	},

	/**
	 * Revert all changes in a session
	 */
	revertAllInSession(sessionId) {
		const changes = this._getFileChanges().filter(
			(c) => c.sessionId === sessionId && c.status === "pending",
		);
		if (changes.length === 0) return;

		this._showConfirmModal({
			title: "Revert All Changes",
			message: `Revert all ${changes.length} change${changes.length !== 1 ? "s" : ""} in this session? This will restore all files to their original content.`,
			confirmText: "Revert All",
			confirmClass: "btn-danger",
			onConfirm: () => {
				const changeIds = changes.map((c) => c.id);

				changes.forEach((c) => {
					if (typeof API !== "undefined" && API.revertChange) {
						API.revertChange(c.id);
					}
					this._removeFromCache(c.id);
				});

				// Clear current diffs if any belong to this session
				this._currentDiffs = this._currentDiffs.filter(
					(d) => !changeIds.includes(d.changeId),
				);

				// If selected file belongs to this session, clear it
				if (this._selectedFile && this._selectedFile.sessionId === sessionId) {
					this._selectedFile = null;
					this._selectedFileKey = null;
					this._currentDiffs = [];
					this.renderEmptyDiff();
				}
			},
		});
	},

	/**
	 * Remove a change from cache
	 */
	_removeFromCache(changeId) {
		this._diffCache.delete(changeId);
		this._editedContent.delete(changeId);
		this._originalContent.delete(changeId);
	},

	// ==========================================================================
	// Modal Dialog
	// ==========================================================================

	/**
	 * Show a confirmation modal
	 */
	_showConfirmModal({ title, message, confirmText, confirmClass, onConfirm }) {
		// Remove any existing modal
		const existing = document.querySelector(".fc-modal-overlay");
		if (existing) existing.remove();

		const modal = document.createElement("div");
		modal.className = "fc-modal-overlay";
		modal.innerHTML = `
      <div class="fc-modal">
        <div class="fc-modal-header">
          <span class="fc-modal-title">${Utils.escapeHtml(title)}</span>
        </div>
        <div class="fc-modal-body">
          <p>${Utils.escapeHtml(message)}</p>
        </div>
        <div class="fc-modal-footer">
          <button class="btn btn-secondary fc-modal-cancel">Cancel</button>
          <button class="btn ${confirmClass} fc-modal-confirm">${Utils.escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

		document.body.appendChild(modal);

		// Animate in
		requestAnimationFrame(() => modal.classList.add("visible"));

		// Cancel button
		modal.querySelector(".fc-modal-cancel").addEventListener("click", () => {
			modal.classList.remove("visible");
			setTimeout(() => modal.remove(), 200);
		});

		// Confirm button
		modal.querySelector(".fc-modal-confirm").addEventListener("click", () => {
			modal.classList.remove("visible");
			setTimeout(() => modal.remove(), 200);
			onConfirm();
		});

		// Click outside to close
		modal.addEventListener("click", (e) => {
			if (e.target === modal) {
				modal.classList.remove("visible");
				setTimeout(() => modal.remove(), 200);
			}
		});

		// Escape key to close
		const handleEscape = (e) => {
			if (e.key === "Escape") {
				modal.classList.remove("visible");
				setTimeout(() => modal.remove(), 200);
				document.removeEventListener("keydown", handleEscape);
			}
		};
		document.addEventListener("keydown", handleEscape);
	},
};

// Register with Router if available
if (typeof Router !== "undefined" && Router.register) {
	Router.register("file-changes", FileChangesView);
}

// Export to window for global access
window.FileChangesView = FileChangesView;
