/**
 * History View - Enhanced with Version Comparison
 * Shows version history for tracked files with comparison capabilities
 */

const HistoryView = {
	_subscriptions: [],

	// Accordion state
	_expandedFiles: new Set(),
	_selectedFile: null, // filePath

	// Comparison state
	_comparisonFrom: null, // version number
	_comparisonTo: null, // version number or 'current'
	_viewMode: "unified", // 'unified' | 'split'
	_comparisonDiff: null, // cached diff result

	// Restore preview state
	_restorePreview: null,

	// Loading state
	_loadingComparison: false,

	// Lazy loading state
	_loadedVersionContent: new Map(), // filePath:versionNumber -> content
	_loadingVersions: new Set(), // Currently loading version keys
	_contentCache: new Map(), // LRU cache for version content

	// Virtual scrolling state
	_virtualScroller: null,
	_VIRTUAL_SCROLL_THRESHOLD: 500, // Lines above which to enable virtual scrolling
	_LINE_HEIGHT: 20, // Estimated line height in pixels
	_BUFFER_SIZE: 50, // Number of lines to render above/below viewport

	/**
	 * Initialize the view
	 */
	init() {
		this.render();

		// Subscribe to state changes
		if (typeof State !== "undefined" && State.subscribe) {
			this._subscriptions.push(
				State.subscribe("trackedFiles", () => {
					this.renderFileAccordions();
				}),
			);
			this._subscriptions.push(
				State.subscribe("versionHistory", () => {
					this.renderFileAccordions();
				}),
			);
		}

		// Fetch tracked files on init
		if (typeof API !== "undefined" && API.getTrackedFiles) {
			API.getTrackedFiles();
		}
	},

	/**
	 * Handle tracked files response from API
	 */
	handleTrackedFiles(payload) {
		// Files are already stored in State by api.js
		// Just re-render the file accordions
		this.renderFileAccordions();
	},

	/**
	 * Cleanup subscriptions when view is deactivated
	 */
	cleanup() {
		this._subscriptions.forEach((unsub) => {
			if (typeof unsub === "function") unsub();
		});
		this._subscriptions = [];
		this._expandedFiles.clear();
		this._selectedFile = null;
		this._comparisonFrom = null;
		this._comparisonTo = null;
		this._viewMode = "unified";
		this._restorePreview = null;
		this._comparisonDiff = null;
		this._loadingComparison = false;
		this._loadedVersionContent.clear();
		this._loadingVersions.clear();
		this._contentCache.clear();
		this._virtualScroller = null;
	},

	/**
	 * Render the main view structure
	 */
	render() {
		const container = document.getElementById("view-history");
		if (!container) return;

		container.innerHTML = `
      <div class="history-v2">
        <div class="hv-header">
          <div class="hv-header-left">
            <h3>Version History</h3>
            <span class="hv-count" id="hv-file-count">0 files</span>
          </div>
        </div>
        <div class="hv-content">
          <div class="hv-files-panel" id="hv-files-panel">
            <div class="empty-state">Loading files...</div>
          </div>
          <div class="hv-viewer-panel" id="hv-viewer-panel">
            <div class="hv-viewer-placeholder">
              <div class="empty-state">
                <div class="empty-state-title">Select a file</div>
                <div class="empty-state-description">Click a file to expand and view version history</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

		this.renderFileAccordions();
	},

	/**
	 * Get file changes from state
	 */
	_getFileChanges() {
		if (typeof State !== "undefined" && State.fileChanges) {
			return State.fileChanges;
		}
		return [];
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
	 * Render version list for a file
	 */
	_renderVersionList(filePath, versions) {
		if (versions.length === 0) {
			return `
        <div class="hv-no-versions">
          <span>No versions recorded yet</span>
          <button class="btn btn-xs" onclick="API.getVersionHistory('${Utils.escapeHtml(filePath)}')">Load History</button>
        </div>
      `;
		}

		// Sort versions newest first
		const sortedVersions = [...versions].sort(
			(a, b) => b.versionNumber - a.versionNumber,
		);

		return `
      <div class="hv-versions">
        ${sortedVersions
					.map((version, idx) => {
						const isCurrent = idx === 0;
						const versionLabel = this._formatVersionLabel(
							version.versionNumber,
							version.timestamp,
						);

						return `
            <div class="hv-version ${isCurrent ? "current" : ""}"
                 data-file-path="${Utils.escapeHtml(filePath)}"
                 data-version="${version.versionNumber}">
              <div class="hv-version-info">
                <span class="hv-version-label">${versionLabel}</span>
                ${isCurrent ? '<span class="hv-version-badge">current</span>' : ""}
              </div>
              <div class="hv-version-meta">
                <span class="hv-version-tool">${Utils.escapeHtml(version.tool || "Unknown")}</span>
                ${version.sessionId ? `<span class="hv-version-session">${Utils.escapeHtml(version.sessionId.slice(0, 8))}</span>` : ""}
              </div>
              <div class="hv-version-actions">
                ${!isCurrent ? `<button class="btn btn-xs btn-warning hv-restore-btn" data-file-path="${Utils.escapeHtml(filePath)}" data-version="${version.versionNumber}">Restore</button>` : ""}
              </div>
            </div>
          `;
					})
					.join("")}
      </div>
    `;
	},

	/**
	 * Format version label: "v3 - Jan 17, 2:30 PM"
	 */
	_formatVersionLabel(versionNumber, timestamp) {
		const date = new Date(timestamp);
		const formatted = date.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
		return `v${versionNumber} - ${formatted}`;
	},

	/**
	 * Format short time for dropdown
	 */
	_formatShortTime(timestamp) {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now - date;
		const diffHours = diffMs / (1000 * 60 * 60);

		if (diffHours < 1) {
			const mins = Math.floor(diffMs / (1000 * 60));
			return `${mins}m ago`;
		} else if (diffHours < 24) {
			return `${Math.floor(diffHours)}h ago`;
		} else if (diffHours < 48) {
			return "Yesterday";
		} else {
			return date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			});
		}
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
	 * Load comparison diff from backend
	 */
	_loadComparison(filePath) {
		if (!this._comparisonFrom || !this._comparisonTo) {
			this._comparisonDiff = null;
			this.renderViewer();
			return;
		}

		this._loadingComparison = true;
		this._comparisonDiff = null;
		this.renderViewer();

		// Call the compare API
		API.compareVersions(filePath, this._comparisonFrom, this._comparisonTo);
	},

	/**
	 * Handle comparison change from dropdowns
	 */
	onComparisonChange(fromVersion, toVersion) {
		this._comparisonFrom = fromVersion;
		this._comparisonTo = toVersion;

		if (this._selectedFile) {
			this._loadComparison(this._selectedFile);
		}
	},

	/**
	 * Render the content viewer
	 */
	renderViewer() {
		const container = document.getElementById("hv-viewer-panel");
		if (!container) return;

		if (this._restorePreview) {
			this.renderRestorePreview(container);
			return;
		}

		if (!this._selectedFile) {
			container.innerHTML = `
        <div class="hv-viewer-placeholder">
          <div class="empty-state">
            <div class="empty-state-title">Select a file</div>
            <div class="empty-state-description">Click a file to expand and view version history</div>
          </div>
        </div>
      `;
			return;
		}

		const filePath = this._selectedFile;
		const versionHistory = this._getVersionHistory();
		const versions = versionHistory[filePath] || [];

		if (versions.length === 0) {
			container.innerHTML = `
        <div class="hv-viewer-placeholder">
          <div class="empty-state">
            <div class="empty-state-title">Loading versions...</div>
          </div>
        </div>
      `;
			return;
		}

		// Sort versions newest first for dropdown
		const sortedVersions = [...versions].sort(
			(a, b) => b.versionNumber - a.versionNumber,
		);
		const fileName = Utils.getFileName(filePath);

		container.innerHTML = `
      <div class="hv-viewer">
        <div class="hv-viewer-header">
          <div class="hv-viewer-title">
            <span class="hv-viewer-file">${Utils.escapeHtml(fileName)}</span>
          </div>
        </div>
        ${this._renderComparisonToolbar(sortedVersions)}
        <div class="hv-viewer-content">
          ${this._renderDiffContent()}
        </div>
      </div>
    `;

		this._setupViewerHandlers(container);

		// Initialize virtual scrolling if needed
		this._initVirtualScroll(container);
	},

	/**
	 * Render comparison toolbar with From/To selectors
	 */
	_renderComparisonToolbar(versions) {
		const hasMultiple = versions.length >= 2;

		return `
      <div class="hv-comparison-toolbar">
        <div class="hv-comparison-dropdowns">
          <label>From:</label>
          <select class="hv-from-version" ${!hasMultiple ? "disabled" : ""}>
            ${versions
							.map(
								(v) => `
              <option value="${v.versionNumber}" ${v.versionNumber === this._comparisonFrom ? "selected" : ""}>
                v${v.versionNumber} - ${this._formatShortTime(v.timestamp)}
              </option>
            `,
							)
							.join("")}
          </select>
          <span class="hv-arrow">→</span>
          <label>To:</label>
          <select class="hv-to-version" ${!hasMultiple ? "disabled" : ""}>
            ${versions
							.map(
								(v) => `
              <option value="${v.versionNumber}" ${v.versionNumber === this._comparisonTo ? "selected" : ""}>
                v${v.versionNumber} - ${this._formatShortTime(v.timestamp)}
              </option>
            `,
							)
							.join("")}
          </select>
        </div>
        <div class="hv-view-toggle">
          <button class="btn btn-xs ${this._viewMode === "unified" ? "active" : ""}" data-mode="unified">Unified</button>
          <button class="btn btn-xs ${this._viewMode === "split" ? "active" : ""}" data-mode="split">Split</button>
        </div>
        <button class="btn btn-xs hv-open-file-btn" title="Open in Editor">Open</button>
      </div>
    `;
	},

	/**
	 * Render diff content based on comparison state
	 */
	_renderDiffContent() {
		if (this._loadingComparison) {
			return `
        <div class="hv-loading">
          <div class="spinner"></div>
          <span>Loading comparison...</span>
        </div>
      `;
		}

		if (!this._comparisonFrom || !this._comparisonTo) {
			// Single version - show full content
			const versionHistory = this._getVersionHistory();
			const versions = versionHistory[this._selectedFile] || [];
			const version = versions.find(
				(v) => v.versionNumber === this._comparisonTo,
			);

			if (!version) {
				return `<div class="hv-no-content">Select versions to compare</div>`;
			}

			return this._renderFullContent(version.content || "(No content)");
		}

		if (!this._comparisonDiff) {
			return `<div class="hv-no-content">No comparison data available</div>`;
		}

		// Always render full file view with highlighted changes
		// This shows the entire file content with hunks/changes highlighted
		return this._renderFullFileDiffView(this._comparisonDiff);
	},

	/**
	 * Render full file diff view - shows entire file with changes highlighted
	 * This gives a complete overview of the file with all changes visible in context
	 */
	_renderFullFileDiffView(diff) {
		const beforeContent = diff.beforeContent || "";
		const afterContent = diff.afterContent || "";
		const hunks = diff.hunks || [];
		const language = Utils.detectLanguage(this._selectedFile, afterContent);

		if (!beforeContent && !afterContent) {
			return `<div class="hv-no-content">No content available</div>`;
		}

		const beforeLines = beforeContent.split("\n");
		const afterLines = afterContent.split("\n");

		// Build change maps from hunks
		const removedLines = new Set(); // old line numbers that were removed
		const addedLines = new Set(); // new line numbers that were added

		hunks.forEach((hunk) => {
			let oldLine = hunk.oldStart || 1;
			let newLine = hunk.newStart || 1;
			(hunk.lines || []).forEach((line) => {
				if (line.type === "removed") {
					removedLines.add(oldLine);
					oldLine++;
				} else if (line.type === "added") {
					addedLines.add(newLine);
					newLine++;
				} else {
					oldLine++;
					newLine++;
				}
			});
		});

		// Render before side (v1)
		const beforeHtml = beforeLines
			.map((content, idx) => {
				const lineNum = idx + 1;
				const isRemoved = removedLines.has(lineNum);
				const lineClass = isRemoved ? "removed" : "context";
				const escaped = Utils.escapeHtml(content);
				const highlighted = this._applySyntaxHighlighting(escaped, language);
				return `
					<div class="hv-full-line ${lineClass}">
						<span class="hv-line-num">${lineNum}</span>
						<span class="hv-line-content">${highlighted || " "}</span>
					</div>
				`;
			})
			.join("");

		// Render after side (v2)
		const afterHtml = afterLines
			.map((content, idx) => {
				const lineNum = idx + 1;
				const isAdded = addedLines.has(lineNum);
				const lineClass = isAdded ? "added" : "context";
				const escaped = Utils.escapeHtml(content);
				const highlighted = this._applySyntaxHighlighting(escaped, language);
				return `
					<div class="hv-full-line ${lineClass}">
						<span class="hv-line-num">${lineNum}</span>
						<span class="hv-line-content">${highlighted || " "}</span>
					</div>
				`;
			})
			.join("");

		return `
			<div class="hv-full-file-diff">
				<div class="hv-diff-stats-bar">
					<span class="hv-stat-add">+${diff.additions || 0}</span>
					<span class="hv-stat-del">-${diff.deletions || 0}</span>
					<span class="hv-stat-hunks">${hunks.length} hunk${hunks.length !== 1 ? "s" : ""}</span>
				</div>
				<div class="hv-full-file-headers">
					<div class="hv-full-file-header">
						<span class="hv-full-file-label">v${this._comparisonFrom} (Before)</span>
						<span class="hv-full-file-lines">${beforeLines.length} lines</span>
					</div>
					<div class="hv-full-file-header">
						<span class="hv-full-file-label">v${this._comparisonTo} (After)</span>
						<span class="hv-full-file-lines">${afterLines.length} lines</span>
					</div>
				</div>
				<div class="hv-full-file-content">
					<div class="hv-full-file-pane hv-full-file-before">
						${beforeHtml || '<div class="hv-full-file-empty">Empty file</div>'}
					</div>
					<div class="hv-full-file-pane hv-full-file-after">
						${afterHtml || '<div class="hv-full-file-empty">Empty file</div>'}
					</div>
				</div>
			</div>
		`;
	},

	/**
	 * Render full file content with virtual scrolling for large files
	 */
	_renderFullContent(content) {
		const lines = content.split("\n");
		const language = Utils.detectLanguage(this._selectedFile, content);

		// Use virtual scrolling for large files
		if (lines.length > this._VIRTUAL_SCROLL_THRESHOLD) {
			return this._renderVirtualScrollContent(lines, language);
		}

		return `
      <div class="hv-code-content">
        ${lines
					.map((line, idx) => {
						const escaped = Utils.escapeHtml(line);
						const highlighted = this._applySyntaxHighlighting(
							escaped,
							language,
						);
						return `
          <div class="hv-code-line">
            <span class="hv-line-num">${idx + 1}</span>
            <span class="hv-line-content">${highlighted || " "}</span>
          </div>
        `;
					})
					.join("")}
      </div>
    `;
	},

	/**
	 * Render content with virtual scrolling for performance
	 */
	_renderVirtualScrollContent(lines, language) {
		const totalHeight = lines.length * this._LINE_HEIGHT;
		const viewportId = `hv-virtual-viewport-${Date.now()}`;

		// Store lines and language for scroll handler
		this._virtualScrollLines = lines;
		this._virtualScrollLanguage = language;

		return `
      <div class="hv-code-content hv-virtual-scroll" id="${viewportId}" style="position: relative; overflow-y: auto; height: 100%;">
        <div class="hv-virtual-scroll-wrapper" style="height: ${totalHeight}px; position: relative;">
          <div class="hv-virtual-scroll-content" id="${viewportId}-content"></div>
        </div>
      </div>
    `;
	},

	/**
	 * Initialize virtual scrolling after render
	 */
	_initVirtualScroll(container) {
		const viewport = container.querySelector(".hv-virtual-scroll");
		if (!viewport || !this._virtualScrollLines) return;

		const content = viewport.querySelector(".hv-virtual-scroll-content");
		if (!content) return;

		const renderVisibleLines = () => {
			const scrollTop = viewport.scrollTop;
			const viewportHeight = viewport.clientHeight;
			const lines = this._virtualScrollLines;
			const language = this._virtualScrollLanguage;

			const startLine = Math.max(
				0,
				Math.floor(scrollTop / this._LINE_HEIGHT) - this._BUFFER_SIZE,
			);
			const endLine = Math.min(
				lines.length,
				Math.ceil((scrollTop + viewportHeight) / this._LINE_HEIGHT) +
					this._BUFFER_SIZE,
			);

			const visibleLines = [];
			const self = this;
			for (let i = startLine; i < endLine; i++) {
				const escaped = Utils.escapeHtml(lines[i]);
				const highlighted = self._applySyntaxHighlighting(escaped, language);
				visibleLines.push(`
          <div class="hv-code-line" style="position: absolute; top: ${i * this._LINE_HEIGHT}px; left: 0; right: 0;">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-content">${highlighted || " "}</span>
          </div>
        `);
			}

			content.innerHTML = visibleLines.join("");
		};

		// Initial render
		renderVisibleLines();

		// Add scroll listener with throttling
		let ticking = false;
		viewport.addEventListener("scroll", () => {
			if (!ticking) {
				requestAnimationFrame(() => {
					renderVisibleLines();
					ticking = false;
				});
				ticking = true;
			}
		});
	},

	/**
	 * Render unified diff view with proper hunks
	 */
	_renderUnifiedDiff(diff) {
		const hunks = diff.hunks || [];
		const language = Utils.detectLanguage(this._selectedFile, "");

		if (hunks.length === 0) {
			return `<div class="hv-no-changes">No changes between selected versions (v${this._comparisonFrom} → v${this._comparisonTo})</div>`;
		}

		let html = '<div class="hv-diff-unified">';

		// Stats bar
		html += `
      <div class="hv-diff-stats">
        <span class="hv-stat-add">+${diff.additions || 0}</span>
        <span class="hv-stat-del">-${diff.deletions || 0}</span>
        <span class="hv-stat-hunks">${hunks.length} hunk${hunks.length !== 1 ? "s" : ""}</span>
      </div>
    `;

		for (const hunk of hunks) {
			html += `
        <div class="hv-hunk">
          <div class="hv-hunk-header">
            <span class="hv-hunk-info">@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@</span>
          </div>
          <div class="hv-hunk-lines">
            ${this._renderHunkLines(hunk.lines || [], language)}
          </div>
        </div>
      `;
		}

		html += "</div>";
		return html;
	},

	/**
	 * Render lines within a hunk
	 */
	_renderHunkLines(lines, language) {
		return lines
			.map((line) => {
				const type = line.type || "context";
				const isMoveFrom = type === "moved-from";
				const isMoveTo = type === "moved-to";
				const prefix =
					type === "added" || isMoveTo
						? "+"
						: type === "removed" || isMoveFrom
							? "-"
							: " ";
				const oldNum =
					line.oldLineNumber !== undefined ? line.oldLineNumber : "";
				const newNum =
					line.newLineNumber !== undefined ? line.newLineNumber : "";
				const moveId = line.moveId || "";

				// Add move indicator for moved lines
				let moveIndicator = "";
				if (isMoveFrom && line.moveId) {
					moveIndicator = `<span class="hv-move-indicator" title="Moved to another location">↓ moved</span>`;
				} else if (isMoveTo && line.moveId) {
					moveIndicator = `<span class="hv-move-indicator" title="Moved from another location">↑ moved</span>`;
				}

				// Apply syntax highlighting
				const escaped = Utils.escapeHtml(line.content || "");
				const highlighted = this._applySyntaxHighlighting(escaped, language);

				return `
        <div class="hv-diff-line ${type}" ${moveId ? `data-move-id="${moveId}"` : ""}>
          <span class="hv-line-num hv-line-num-old">${oldNum}</span>
          <span class="hv-line-num hv-line-num-new">${newNum}</span>
          <span class="hv-line-prefix">${prefix}</span>
          <span class="hv-line-content">${highlighted || " "}${moveIndicator}</span>
        </div>
      `;
			})
			.join("");
	},

	/**
	 * Render split (side-by-side) diff view
	 */
	_renderSplitDiff(diff) {
		const hunks = diff.hunks || [];
		const language = Utils.detectLanguage(this._selectedFile, "");

		if (hunks.length === 0) {
			return `<div class="hv-no-changes">No changes between selected versions</div>`;
		}

		let html = '<div class="hv-diff-split">';

		// Stats bar
		html += `
      <div class="hv-diff-stats">
        <span class="hv-stat-add">+${diff.additions || 0}</span>
        <span class="hv-stat-del">-${diff.deletions || 0}</span>
        <span class="hv-stat-hunks">${hunks.length} hunk${hunks.length !== 1 ? "s" : ""}</span>
      </div>
    `;

		for (const hunk of hunks) {
			const { leftLines, rightLines } = this._splitHunkLines(hunk.lines || []);

			html += `
        <div class="hv-hunk-split">
          <div class="hv-hunk-header-split">
            @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@
          </div>
          <div class="hv-split-container">
            <div class="hv-split-left">
              ${this._renderSplitSide(leftLines, "old", language)}
            </div>
            <div class="hv-split-right">
              ${this._renderSplitSide(rightLines, "new", language)}
            </div>
          </div>
        </div>
      `;
		}

		html += "</div>";
		return html;
	},

	/**
	 * Split hunk lines into left (old) and right (new) columns
	 */
	_splitHunkLines(lines) {
		const leftLines = [];
		const rightLines = [];

		for (const line of lines) {
			if (line.type === "removed" || line.type === "moved-from") {
				leftLines.push(line);
				rightLines.push({ type: "empty", content: "" });
			} else if (line.type === "added" || line.type === "moved-to") {
				leftLines.push({ type: "empty", content: "" });
				rightLines.push(line);
			} else {
				leftLines.push(line);
				rightLines.push(line);
			}
		}

		return { leftLines, rightLines };
	},

	/**
	 * Render one side of a split diff
	 */
	_renderSplitSide(lines, side, language) {
		return lines
			.map((line) => {
				const type = line.type || "context";
				const isMoveFrom = type === "moved-from";
				const isMoveTo = type === "moved-to";
				const lineNum =
					side === "old" ? line.oldLineNumber || "" : line.newLineNumber || "";
				const moveId = line.moveId || "";

				// Add move indicator for moved lines
				let moveIndicator = "";
				if (isMoveFrom && line.moveId) {
					moveIndicator = `<span class="hv-move-indicator" title="Moved to another location">↓</span>`;
				} else if (isMoveTo && line.moveId) {
					moveIndicator = `<span class="hv-move-indicator" title="Moved from another location">↑</span>`;
				}

				// Apply syntax highlighting
				let contentHtml = "";
				if (type !== "empty") {
					const escaped = Utils.escapeHtml(line.content || "");
					const highlighted = this._applySyntaxHighlighting(escaped, language);
					contentHtml = highlighted || " ";
				}

				return `
        <div class="hv-split-line ${type}" ${moveId ? `data-move-id="${moveId}"` : ""}>
          <span class="hv-line-num">${lineNum}</span>
          <span class="hv-line-content">${contentHtml}${moveIndicator}</span>
        </div>
      `;
			})
			.join("");
	},

	/**
	 * Set up viewer handlers
	 */
	_setupViewerHandlers(container) {
		// View mode toggle
		container.querySelectorAll(".hv-view-toggle button").forEach((btn) => {
			btn.addEventListener("click", () => {
				this._viewMode = btn.dataset.mode;
				this.renderViewer();
			});
		});

		// From version selector
		const fromSelect = container.querySelector(".hv-from-version");
		if (fromSelect) {
			fromSelect.addEventListener("change", () => {
				const fromVersion = parseInt(fromSelect.value, 10);
				this.onComparisonChange(fromVersion, this._comparisonTo);
			});
		}

		// To version selector
		const toSelect = container.querySelector(".hv-to-version");
		if (toSelect) {
			toSelect.addEventListener("change", () => {
				const toVersion = parseInt(toSelect.value, 10);
				this.onComparisonChange(this._comparisonFrom, toVersion);
			});
		}

		// Open file button
		const openBtn = container.querySelector(".hv-open-file-btn");
		if (openBtn) {
			openBtn.addEventListener("click", () => {
				if (this._selectedFile) {
					API.openFile(this._selectedFile);
				}
			});
		}
	},

	/**
	 * Show restore preview
	 */
	showRestorePreview(filePath, versionNumber) {
		const versionHistory = this._getVersionHistory();
		const versions = versionHistory[filePath] || [];
		const sortedVersions = [...versions].sort(
			(a, b) => b.versionNumber - a.versionNumber,
		);
		const version = versions.find((v) => v.versionNumber === versionNumber);
		const currentVersion = sortedVersions[0];

		if (!version || !currentVersion) return;

		this._restorePreview = {
			filePath,
			versionNumber,
			version,
			currentVersion,
		};

		this.renderViewer();
	},

	/**
	 * Render restore preview
	 */
	renderRestorePreview(container) {
		const { filePath, versionNumber, version, currentVersion } =
			this._restorePreview;
		const language = Utils.detectLanguage(filePath, version.content || "");
		const versionLabel = this._formatVersionLabel(
			versionNumber,
			version.timestamp,
		);

		container.innerHTML = `
      <div class="hv-restore-preview">
        <div class="hv-restore-header">
          <div class="hv-restore-title">
            <span class="hv-restore-icon">&#9888;</span>
            <span>Restore ${Utils.escapeHtml(Utils.getFileName(filePath))} to ${versionLabel}?</span>
          </div>
          <div class="hv-restore-warning">
            This will overwrite the current file. Changes shown below will be applied.
          </div>
        </div>
        <div class="hv-restore-diff">
          ${this._renderSimpleDiff(currentVersion.content || "", version.content || "", language)}
        </div>
        <div class="hv-restore-actions">
          <button class="btn btn-secondary hv-restore-cancel">Cancel</button>
          <button class="btn btn-warning hv-restore-confirm">Restore Version</button>
        </div>
      </div>
    `;

		// Set up handlers
		container
			.querySelector(".hv-restore-cancel")
			?.addEventListener("click", () => {
				this._restorePreview = null;
				this.renderViewer();
			});

		container
			.querySelector(".hv-restore-confirm")
			?.addEventListener("click", () => {
				API.restoreVersion(filePath, versionNumber);
				this._restorePreview = null;
				this._selectedFile = null;
				this._comparisonFrom = null;
				this._comparisonTo = null;
				this._comparisonDiff = null;
				this.renderViewer();
			});
	},

	/**
	 * Render simple line-by-line diff for restore preview
	 */
	_renderSimpleDiff(oldContent, newContent, language) {
		const oldLines = oldContent.split("\n");
		const newLines = newContent.split("\n");
		const maxLines = Math.max(oldLines.length, newLines.length);

		// Helper to escape and highlight
		const highlight = (line) => {
			const escaped = Utils.escapeHtml(line || "");
			return this._applySyntaxHighlighting(escaped, language) || " ";
		};

		let html = '<div class="hv-diff-content">';

		for (let i = 0; i < maxLines; i++) {
			const oldLine = oldLines[i];
			const newLine = newLines[i];

			if (oldLine === newLine) {
				html += `
          <div class="hv-diff-line context">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix"> </span>
            <span class="hv-line-content">${highlight(newLine)}</span>
          </div>
        `;
			} else if (oldLine !== undefined && newLine !== undefined) {
				html += `
          <div class="hv-diff-line removed">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">-</span>
            <span class="hv-line-content">${highlight(oldLine)}</span>
          </div>
          <div class="hv-diff-line added">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">+</span>
            <span class="hv-line-content">${highlight(newLine)}</span>
          </div>
        `;
			} else if (oldLine !== undefined) {
				html += `
          <div class="hv-diff-line removed">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">-</span>
            <span class="hv-line-content">${highlight(oldLine)}</span>
          </div>
        `;
			} else {
				html += `
          <div class="hv-diff-line added">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">+</span>
            <span class="hv-line-content">${highlight(newLine)}</span>
          </div>
        `;
			}
		}

		html += "</div>";
		return html;
	},

	/**
	 * Get cached version content key
	 */
	_getVersionContentKey(filePath, versionNumber) {
		return `${filePath}:${versionNumber}`;
	},

	/**
	 * Request version content with lazy loading
	 */
	requestVersionContent(filePath, versionNumber) {
		const key = this._getVersionContentKey(filePath, versionNumber);

		// Return cached content if available
		if (this._loadedVersionContent.has(key)) {
			return this._loadedVersionContent.get(key);
		}

		// Check if already loading
		if (this._loadingVersions.has(key)) {
			return null;
		}

		// Request content from API
		this._loadingVersions.add(key);
		API.getVersionContent(filePath, versionNumber);
		return null;
	},

	/**
	 * Handle version content response from API
	 */
	handleVersionContent(payload) {
		const { filePath, versionNumber, content } = payload;
		const key = this._getVersionContentKey(filePath, versionNumber);

		// Store in cache
		this._loadedVersionContent.set(key, content);
		this._loadingVersions.delete(key);

		// Manage cache size (keep last 50 versions)
		if (this._loadedVersionContent.size > 50) {
			const firstKey = this._loadedVersionContent.keys().next().value;
			this._loadedVersionContent.delete(firstKey);
		}

		// Re-render if this is for the currently selected file
		if (this._selectedFile === filePath) {
			this.renderViewer();
		}
	},

	/**
	 * Check if version content is loaded
	 */
	isVersionContentLoaded(filePath, versionNumber) {
		const key = this._getVersionContentKey(filePath, versionNumber);
		return this._loadedVersionContent.has(key);
	},

	/**
	 * Check if version content is currently loading
	 */
	isVersionContentLoading(filePath, versionNumber) {
		const key = this._getVersionContentKey(filePath, versionNumber);
		return this._loadingVersions.has(key);
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

	/**
	 * Handle version comparison response from API
	 */
	handleVersionComparison(payload) {
		this._loadingComparison = false;

		if (payload.diff) {
			this._comparisonDiff = payload.diff;
		} else {
			this._comparisonDiff = null;
		}

		this.renderViewer();
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
};

// Register with Router if available
if (typeof Router !== "undefined" && Router.register) {
	Router.register("history", HistoryView);
}

// Export to window for global access
window.HistoryView = HistoryView;
