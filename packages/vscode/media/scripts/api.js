/**
 * API Communication with VS Code Extension
 * Handles message passing between webview and extension
 *
 * `mergeActivity` lives in scripts/shared/activity-merge.js and is loaded
 * before this file. It is referenced here as a bare global, which resolves
 * across classic script tags.
 */

const API = {
	// VS Code API instance
	vscode: typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null,

	/**
	 * Send a command to the extension
	 * @param {string} command - Command name
	 * @param {Object} params - Command parameters
	 */
	send(command, params = {}) {
		if (this.vscode) {
			this.vscode.postMessage({ command, params });
		}
	},

	// ==========================================================================
	// Logs API
	// ==========================================================================

	/**
	 * Get logs with optional filtering
	 * @param {Object} filter - Filter options (search, level, hook, session)
	 */
	getLogs(filter = {}) {
		this.send("get-logs", {
			filter,
			pagination: { limit: 100 },
		});
	},

	/**
	 * Clear logs
	 * @param {Object} filter - Optional filter to clear specific logs
	 */
	clearLogs(filter = {}) {
		this.send("clear-logs", { filter });
	},

	// ==========================================================================
	// Sessions API
	// ==========================================================================

	/**
	 * Get all sessions
	 * @param {Object} params - Optional params (status, limit)
	 */
	getSessions(params = {}) {
		this.send("get-sessions", params);
	},

	/**
	 * Get a single session by ID
	 * @param {string} sessionId - Session ID
	 */
	getSession(sessionId) {
		this.send("get-session", { sessionId });
	},

	/**
	 * Delete a session
	 * @param {string} sessionId - Session ID
	 */
	deleteSession(sessionId) {
		this.send("delete-session", { sessionId });
	},

	/**
	 * Get logs for a specific session
	 * @param {string} sessionId - Session ID
	 */
	getSessionLogs(sessionId) {
		this.send("get-session-logs", { sessionId });
	},

	/**
	 * Get activity feed for a session (ordered events: prompts, responses, tools)
	 * @param {string} sessionId - Session ID
	 */
	getSessionActivity(sessionId, options = {}) {
		// `since` asks for only what changed, which is the difference between a
		// few hundred bytes and the whole window every two seconds. `before`
		// backfills older items past the window cap.
		this.send("get-session-activity", {
			sessionId,
			...(options.since ? { since: options.since } : {}),
			...(options.before ? { before: options.before } : {}),
		});
	},

	// ==========================================================================
	// File Changes API
	// ==========================================================================

	/**
	 * Get pending file changes
	 * @param {Object} params - Optional params (sessionId)
	 */
	getFileChanges(params = {}) {
		this.send("get-file-changes", params);
	},

	/**
	 * Get diff for a specific change
	 * @param {string} changeId - Change ID
	 */
	getDiff(changeId) {
		this.send("get-diff", { changeId });
	},

	/**
	 * Keep (approve) a change
	 * @param {string} changeId - Change ID
	 */
	keepChange(changeId) {
		this.send("keep-change", { changeId });
	},

	/**
	 * Revert a change
	 * @param {string} changeId - Change ID
	 */
	revertChange(changeId) {
		this.send("revert-change", { changeId });
	},

	/**
	 * Keep all pending changes
	 */
	keepAllChanges() {
		this.send("keep-all-changes", {});
	},

	/**
	 * Revert all pending changes
	 */
	revertAllChanges() {
		this.send("revert-all-changes", {});
	},

	/**
	 * Update change content (for inline editing)
	 * @param {string} changeId - Change ID
	 * @param {string} afterContent - New content after editing
	 */
	updateChangeContent(changeId, afterContent) {
		this.send("update-change-content", { changeId, afterContent });
	},

	/**
	 * Keep an individual hunk (if supported by backend)
	 * @param {string} changeId - Change ID
	 * @param {number} hunkIndex - Hunk index to keep
	 */
	keepHunk(changeId, hunkIndex) {
		this.send("keep-hunk", { changeId, hunkIndex });
	},

	/**
	 * Revert an individual hunk (if supported by backend)
	 * @param {string} changeId - Change ID
	 * @param {number} hunkIndex - Hunk index to revert
	 */
	revertHunk(changeId, hunkIndex) {
		this.send("revert-hunk", { changeId, hunkIndex });
	},

	// ==========================================================================
	// Version History API
	// ==========================================================================

	/**
	 * Get all tracked files with version history
	 */
	getTrackedFiles() {
		this.send("get-tracked-files", {});
	},

	/**
	 * Get version history for a file
	 * @param {string} filePath - File path
	 */
	getVersionHistory(filePath) {
		this.send("get-version-history", { filePath });
	},

	/**
	 * Restore a specific version
	 * @param {string} filePath - File path
	 * @param {number} versionNumber - Version number to restore
	 */
	restoreVersion(filePath, versionNumber) {
		this.send("restore-version", { filePath, versionNumber });
	},

	/**
	 * Compare two versions
	 * @param {string} filePath - File path
	 * @param {number} v1 - First version number
	 * @param {number} v2 - Second version number
	 */
	compareVersions(filePath, v1, v2) {
		this.send("compare-versions", { filePath, v1, v2 });
	},

	/**
	 * Compare a version to current disk content
	 * @param {string} filePath - File path
	 * @param {number} versionNumber - Version to compare from
	 */
	compareVersionToDisk(filePath, versionNumber) {
		this.send("compare-version-to-disk", { filePath, versionNumber });
	},

	/**
	 * Delete a specific version
	 * @param {string} filePath - File path
	 * @param {number} versionNumber - Version number to delete
	 */
	deleteVersion(filePath, versionNumber) {
		this.send("delete-version", { filePath, versionNumber });
	},

	/**
	 * Get the stored content of one version.
	 *
	 * history.js has always called this; it did not exist, so opening a version
	 * in the viewer threw "API.getVersionContent is not a function" and no
	 * request was ever sent. The core exposes history.getVersionContent; the
	 * extension-side case and CoreBridge method are still needed for a response
	 * to come back, so until those land this leaves the viewer showing its
	 * loading state instead of throwing.
	 *
	 * @param {string} filePath - File path
	 * @param {number} versionNumber - Version number
	 */
	getVersionContent(filePath, versionNumber) {
		this.send("get-version-content", { filePath, versionNumber });
	},

	// ==========================================================================
	// Archived Changes API
	// ==========================================================================

	/**
	 * Get archived changes
	 */
	getArchivedChanges() {
		this.send("get-archived-changes", {});
	},

	/**
	 * Get the diff for an ARCHIVED change.
	 *
	 * Separate from getDiff because the tracker keeps kept/reverted changes in
	 * a different map: `fileChanges.getDiff` reads `this.changes` and returns
	 * null for anything archived, by construction. Every archived diff had
	 * therefore always come back empty -- 155 of 155 on this machine -- and
	 * rendered as "+0 / -0" rather than as an error.
	 *
	 * @param {string} changeId - Change ID
	 */
	getArchivedDiff(changeId) {
		this.send("get-archived-diff", { changeId });
	},

	/**
	 * Restore an archived change
	 * @param {string} changeId - Change ID
	 */
	restoreArchived(changeId) {
		this.send("restore-archived", { changeId });
	},

	// ==========================================================================
	// File Operations
	// ==========================================================================

	/**
	 * Open a file in the editor
	 * @param {string} filePath - File path
	 * @param {number} line - Optional line number
	 */
	openFile(filePath, line) {
		this.send("open-file", { filePath, line });
	},

	// ==========================================================================
	// UI Helpers
	// ==========================================================================

	/**
	 * Update tab badge count
	 * @param {string} badge - Badge type ('logs' or 'changes')
	 * @param {number} count - Count to display
	 * @private
	 */
	_updateTabBadge(badge, count) {
		const elementId = badge === "logs" ? "tab-logs-count" : "tab-changes-count";
		const element = document.getElementById(elementId);
		if (element) {
			element.textContent = count > 99 ? "99+" : count.toString();
		}
	},

	// ==========================================================================
	// Message Handler
	// ==========================================================================

	/**
	 * Handle incoming messages from the extension
	 * @param {MessageEvent} event - Message event
	 */
	handleMessage(event) {
		const { type, payload } = event.data || {};

		if (!type) {
			return;
		}

		switch (type) {
			case "ping":
				// Respond to ping from extension
				this.send("pong", {
					received: payload?.timestamp,
					responded: Date.now(),
				});
				break;

			case "init":
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
				break;

			case "stats":
				State.update("stats", payload);
				break;

			case "log": {
				// Single new log entry
				const logs = [payload, ...State.logs].slice(0, State.config.maxLogs);
				State.update("logs", logs);
				// Update tab badge
				this._updateTabBadge("logs", logs.length);
				break;
			}

			case "logs": {
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
				break;
			}

			case "sessions":
				State.update("sessions", payload.sessions || []);
				break;

			case "session": {
				// Single session update
				const sessions = [...State.sessions];
				const sessionIdx = sessions.findIndex((s) => s.id === payload.id);
				if (sessionIdx >= 0) {
					sessions[sessionIdx] = payload;
				} else {
					sessions.unshift(payload);
				}
				State.update("sessions", sessions);
				break;
			}

			case "session-logs":
				// Session logs response
				State.update("sessionView", {
					...State.sessionView,
					sessionLogs: payload?.logs || [],
				});
				break;

			case "session-activity": {
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
				break;
			}

			case "fileChanges":
			case "file-changes":
				State.update("fileChanges", payload.changes || []);
				this._updateTabBadge("changes", (payload.changes || []).length);
				break;

			case "fileChange": {
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
				break;
			}

			case "diff-result":
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
				break;

			case "diff-error":
				// Routed like diff-result: to the view that asked.
				if (
					State.currentView === "archived" &&
					window.ArchivedView?.handleDiffError
				) {
					window.ArchivedView.handleDiffError(payload);
				} else if (window.FileChangesView?.handleDiffError) {
					window.FileChangesView.handleDiffError(payload);
				}
				break;

			case "tracked-files":
				// Store tracked files list in state
				State.update("trackedFiles", payload.files || []);
				// Notify history view
				if (window.HistoryView?.handleTrackedFiles) {
					window.HistoryView.handleTrackedFiles(payload);
				}
				break;

			case "version-history":
				// Handle null payload or missing fields
				if (payload && payload.filePath) {
					State.update("versionHistory", {
						...State.versionHistory,
						[payload.filePath]: payload.versions || [],
					});
					// Also notify history view
					if (window.HistoryView?.handleVersionHistory) {
						window.HistoryView.handleVersionHistory(payload);
					}
				}
				break;

			case "version-comparison":
				// Version comparison result - handled by history view
				if (window.HistoryView?.handleVersionComparison) {
					window.HistoryView.handleVersionComparison(payload);
				}
				break;

			// A deleted session produces no push event from the core - unlike a
			// kept or reverted change, which arrives as "fileChange" - so without
			// this the sidebar keeps showing the session until the 30s list poll.
			case "delete-session-result":
				if (payload?.success !== false) this.getSessions();
				break;

			// Same gap for versions: the core emits version:created and
			// version:restored but nothing for a delete, so History would keep
			// listing a version that is gone.
			case "delete-version-result":
				if (payload?.success !== false) this.getTrackedFiles();
				break;

			// One case for stage/get/clear: each ends with "here is what is staged,
			// or nothing", so the view re-renders from whatever came back.
			//
			// A REFUSAL also comes back here, as `{staged:false, reason}`. That
			// object is truthy, so assigning it straight to `staged` drew the
			// "Staged for the next session" box over an empty body and an
			// invalid expiry -- a failure rendered as a success, with the reason
			// discarded. Branch on the explicit flag, and keep the reason.
			case "memory-staged": {
				const refused = payload && payload.staged === false;
				State.update("contextView", {
					...State.contextView,
					staged: refused ? null : payload || null,
					stageRefusal: refused ? payload.reason || "Staging was refused." : null,
				});
				break;
			}

			case "memory-digest":
				State.update("contextView", {
					...State.contextView,
					digest: payload || null,
				});
				break;

			case "memory-projects":
				State.update("contextView", {
					...State.contextView,
					projects: payload?.projects || payload || [],
				});
				break;

			// One shape for every curation result. The backend answers a refusal
			// with a human-readable `reason`, and the view renders it verbatim -
			// paraphrasing would lose the detail that makes it actionable.
			case "memory-result": {
				State.update("contextView", {
					...State.contextView,
					lastResult: payload || null,
				});
				// Re-read rather than patching local state: the index, the file and
				// its orphan status can all have changed together.
				this.memoryGetProjects({ includeEmpty: true });
				break;
			}

			case "archived":
				State.update("archivedChanges", payload.changes || []);
				break;

			// A restore mutates the archive and the file's version history, but
			// neither result had a handler at all, so the UI kept showing the
			// change as still archived until the panel was reopened.
			case "restore-archived-result":
				if (payload?.success !== false) {
					this.getArchivedChanges();
					this.getTrackedFiles();
				}
				break;

			case "restore-result":
				if (payload?.success !== false) {
					this.getTrackedFiles();
					this.getArchivedChanges();
				}
				break;

			// Raw content for one stored version. history.js has always called
			// API.getVersionContent, which did not exist - so opening a version in
			// the viewer threw "is not a function" and the request was never sent.
			case "version-content":
				if (window.HistoryView?.handleVersionContent) {
					window.HistoryView.handleVersionContent(payload);
				}
				break;

			case "error":
				// Handle error messages from extension
				// Could show a toast/notification here
				break;

			default:
				// Unknown message type - silently ignore
				break;
		}
	},
};

// Set up message listener
window.addEventListener("message", (event) => API.handleMessage(event));

// Make globally available
// Senders split into ./api/, composed after the literal so a missing module
// is a load-time absence rather than a silently undefined method.
Object.assign(API, window.MemoryApiMixin);

window.API = API;
