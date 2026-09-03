/**
 * History: the tracked-file accordion list and file selection.
 *
 * Moved verbatim out of history.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const HistoryFileListMixin = {
	/**
	 * Handle tracked files response from API
	 */
	handleTrackedFiles(payload) {
		// Files are already stored in State by api.js
		// Just re-render the file accordions
		this.renderFileAccordions();
	},

	/**
	 * Get version history from state
	 */
	_getVersionHistory() {
		if (typeof State !== "undefined" && State.versionHistory) {
			return State.versionHistory;
		}
		return {};
	},

	/**
	 * Get tracked files from state
	 * Returns array of file paths that have version history
	 */
	_getTrackedFiles() {
		if (typeof State !== "undefined" && State.trackedFiles) {
			return State.trackedFiles;
		}
		return [];
	},

	/**
	 * Get unique files from tracked files
	 */
	_getUniqueFiles() {
		const trackedFiles = this._getTrackedFiles();
		// trackedFiles is an array of { filePath, versionCount, lastModified }
		return trackedFiles.map((f) => f.filePath).filter(Boolean);
	},

	/**
	 * Render the file accordions
	 */
	renderFileAccordions() {
		const container = document.getElementById("hv-files-panel");
		if (!container) return;

		const trackedFiles = this._getTrackedFiles();
		const versionHistory = this._getVersionHistory();

		// Update count
		const countEl = document.getElementById("hv-file-count");
		if (countEl) {
			countEl.textContent = `${trackedFiles.length} file${trackedFiles.length !== 1 ? "s" : ""}`;
		}

		if (trackedFiles.length === 0) {
			container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No tracked files</div>
          <div class="empty-state-description">Files with version history will appear here</div>
        </div>
      `;
			return;
		}

		container.innerHTML = trackedFiles
			.map((fileInfo) => {
				const filePath = fileInfo.filePath;
				const isExpanded = this._expandedFiles.has(filePath);
				const isSelected = this._selectedFile === filePath;
				const fileName = Utils.getFileName(filePath);
				const versions = versionHistory[filePath] || [];
				// Use versionCount from trackedFiles if versions not loaded yet
				const versionCount =
					versions.length > 0 ? versions.length : fileInfo.versionCount || 0;

				return `
        <div class="hv-file ${isExpanded ? "expanded" : ""} ${isSelected ? "selected" : ""}" data-file-path="${Utils.escapeHtml(filePath)}">
          <div class="hv-file-header" data-file-path="${Utils.escapeHtml(filePath)}">
            <span class="hv-expand-icon">${isExpanded ? "&#9660;" : "&#9654;"}</span>
            <span class="hv-file-name" title="${Utils.escapeHtml(filePath)}">${Utils.escapeHtml(fileName)}</span>
            <span class="hv-version-count">${versionCount} version${versionCount !== 1 ? "s" : ""}</span>
          </div>
          <div class="hv-file-content ${isExpanded ? "" : "hidden"}">
            ${isExpanded ? this._renderVersionList(filePath, versions) : ""}
          </div>
        </div>
      `;
			})
			.join("");

		this._setupFileHandlers(container);
	},

	/**
	 * Set up handlers for file accordions
	 */
	_setupFileHandlers(container) {
		// File header click - toggle expand and select
		container.querySelectorAll(".hv-file-header").forEach((header) => {
			header.addEventListener("click", () => {
				const filePath = header.dataset.filePath;
				this.selectFile(filePath);
			});
		});

		// Restore button
		container.querySelectorAll(".hv-restore-btn").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const filePath = btn.dataset.filePath;
				const versionNum = parseInt(btn.dataset.version, 10);
				this.showRestorePreview(filePath, versionNum);
			});
		});

		// Delete button
		container.querySelectorAll(".hv-delete-btn").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const filePath = btn.dataset.filePath;
				const versionNum = parseInt(btn.dataset.version, 10);
				this._confirmDeleteVersion(filePath, versionNum);
			});
		});

		// Version row click - select version for viewing
		container.querySelectorAll(".hv-version").forEach((row) => {
			row.addEventListener("click", (e) => {
				// Don't trigger if clicking a button
				if (e.target.closest("button")) return;

				const filePath = row.dataset.filePath;
				const versionNum = parseInt(row.dataset.version, 10);
				this._selectVersion(filePath, versionNum);
			});
		});
	},

	/**
	 * Select a file and show comparison view
	 */
	selectFile(filePath) {
		const wasExpanded = this._expandedFiles.has(filePath);

		// Toggle expansion
		if (wasExpanded && this._selectedFile === filePath) {
			this._expandedFiles.delete(filePath);
			this._selectedFile = null;
			this._comparisonFrom = null;
			this._comparisonTo = null;
			this._comparisonDiff = null;
		} else {
			this._expandedFiles.add(filePath);
			this._selectedFile = filePath;

			// Request version history if not loaded
			const versionHistory = this._getVersionHistory();
			if (!versionHistory[filePath] || versionHistory[filePath].length === 0) {
				API.getVersionHistory(filePath);
			} else {
				// Set default comparison (previous to current)
				const versions = versionHistory[filePath];
				if (versions.length >= 2) {
					const sorted = [...versions].sort(
						(a, b) => b.versionNumber - a.versionNumber,
					);
					this._comparisonTo = sorted[0].versionNumber;
					this._comparisonFrom = sorted[1].versionNumber;
					this._loadComparison(filePath);
				} else if (versions.length === 1) {
					this._comparisonTo = versions[0].versionNumber;
					this._comparisonFrom = null;
				}
			}
		}

		this.renderFileAccordions();
		this.renderViewer();
	},

	/**
	 * Handle version history response from API
	 */
	handleVersionHistory(payload) {
		// Version history is stored in State by API.handleMessage
		// Just re-render
		this.renderFileAccordions();

		// If this is the selected file, set up comparison
		if (this._selectedFile === payload.filePath) {
			const versions = payload.versions || [];
			if (versions.length >= 2) {
				const sorted = [...versions].sort(
					(a, b) => b.versionNumber - a.versionNumber,
				);
				this._comparisonTo = sorted[0].versionNumber;
				this._comparisonFrom = sorted[1].versionNumber;
				this._loadComparison(payload.filePath);
			} else if (versions.length === 1) {
				this._comparisonTo = versions[0].versionNumber;
				this._comparisonFrom = null;
				this.renderViewer();
			}
		}
	},
};

window.HistoryFileListMixin = HistoryFileListMixin;
