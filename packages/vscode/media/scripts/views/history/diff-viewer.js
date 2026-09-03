/**
 * History: the content viewer - comparison toolbar, unified and split diffs.
 *
 * Moved verbatim out of history.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const HistoryDiffViewerMixin = {
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
		const stats = this._comparisonDiff
			? `+${this._comparisonDiff.additions || 0} -${this._comparisonDiff.deletions || 0}`
			: "";
		const hunkCount = this._comparisonDiff?.hunks?.length || 0;

		// Determine if we can navigate
		const sortedVersions = [...versions].sort(
			(a, b) => b.versionNumber - a.versionNumber,
		);
		const currentToIdx = sortedVersions.findIndex(
			(v) => v.versionNumber === this._comparisonTo,
		);
		const canGoPrev = currentToIdx < sortedVersions.length - 1;
		const canGoNext = currentToIdx > 0;

		return `
      <div class="hv-comparison-toolbar">
        <div class="hv-toolbar-path">
          <span class="hv-path-text" title="${Utils.escapeHtml(this._selectedFile || "")}">${Utils.escapeHtml(this._selectedFile || "")}</span>
          <button class="hv-copy-path" title="Copy path">📋</button>
        </div>
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
          <select class="hv-to-version">
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
        ${stats ? `<div class="hv-toolbar-stats"><span class="hv-stat-add">${stats.split(" ")[0]}</span><span class="hv-stat-del">${stats.split(" ")[1]}</span><span class="hv-stat-hunks">${hunkCount} hunk${hunkCount !== 1 ? "s" : ""}</span></div>` : ""}
        <div class="hv-view-toggle">
          <button class="btn btn-xs ${this._viewMode === "full" ? "active" : ""}" data-mode="full">Full</button>
          <button class="btn btn-xs ${this._viewMode === "split" ? "active" : ""}" data-mode="split">Split</button>
        </div>
        <div class="hv-version-nav">
          <button class="btn btn-xs hv-prev-version" ${!canGoPrev ? "disabled" : ""} title="Previous version">&lt;</button>
          <button class="btn btn-xs hv-next-version" ${!canGoNext ? "disabled" : ""} title="Next version">&gt;</button>
        </div>
        <button class="btn btn-xs hv-open-file-btn" title="Open in Editor">Open</button>
        <button class="btn btn-xs btn-warning hv-restore-toolbar-btn" title="Restore this version">Restore</button>
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

		// Route to appropriate view based on mode
		if (this._viewMode === "full") {
			// Single file view with highlighted changes
			return this._renderFullViewSingleFile(this._comparisonDiff);
		} else {
			// Side-by-side split view
			return this._renderFullFileDiffView(this._comparisonDiff);
		}
	},

	/**
	 * Render Full View - Single file with highlighted changes
	 * Shows the "after" file content with changed lines highlighted
	 */
	_renderFullViewSingleFile(diff) {
		const afterContent = diff.afterContent || "";
		const hunks = diff.hunks || [];
		const language = Utils.detectLanguage(this._selectedFile, afterContent);

		if (!afterContent) {
			return `<div class="hv-no-content">No content available</div>`;
		}

		const afterLines = afterContent.split("\n");

		// Build set of changed line numbers from hunks
		const addedLines = new Set(); // new line numbers that were added
		const removedMarkers = new Map(); // new line number -> array of removed content

		hunks.forEach((hunk) => {
			let newLine = hunk.newStart || 1;
			let pendingRemoved = [];

			(hunk.lines || []).forEach((line) => {
				if (line.type === "removed") {
					pendingRemoved.push(line.content);
				} else if (line.type === "added") {
					addedLines.add(newLine);
					// Attach any pending removed lines as markers
					if (pendingRemoved.length > 0) {
						if (!removedMarkers.has(newLine)) {
							removedMarkers.set(newLine, []);
						}
						removedMarkers.get(newLine).push(...pendingRemoved);
						pendingRemoved = [];
					}
					newLine++;
				} else {
					// Context line - flush any pending removed
					if (pendingRemoved.length > 0) {
						if (!removedMarkers.has(newLine)) {
							removedMarkers.set(newLine, []);
						}
						removedMarkers.get(newLine).push(...pendingRemoved);
						pendingRemoved = [];
					}
					newLine++;
				}
			});

			// Handle trailing removed lines
			if (pendingRemoved.length > 0) {
				const markerLine = Math.min(newLine, afterLines.length);
				if (!removedMarkers.has(markerLine)) {
					removedMarkers.set(markerLine, []);
				}
				removedMarkers.get(markerLine).push(...pendingRemoved);
			}
		});

		// Calculate scrollbar markers
		const scrollbarMarkers = this._renderScrollbarMarkers(
			addedLines,
			removedMarkers,
			afterLines.length,
		);

		// Render the single file view
		let html = `
			<div class="hv-full-view-single">
				<div class="hv-diff-stats-bar">
					<span class="hv-stat-add">+${diff.additions || 0}</span>
					<span class="hv-stat-del">-${diff.deletions || 0}</span>
					<span class="hv-stat-hunks">${hunks.length} hunk${hunks.length !== 1 ? "s" : ""}</span>
					<span class="hv-stat-lines">${afterLines.length} lines</span>
				</div>
				<div class="hv-full-view-content">
		`;

		afterLines.forEach((content, idx) => {
			const lineNum = idx + 1;
			const isAdded = addedLines.has(lineNum);
			const hasRemovedMarker = removedMarkers.has(lineNum);
			const lineClass = isAdded ? "added" : "context";

			const escaped = Utils.escapeHtml(content);
			const highlighted = this._applySyntaxHighlighting(escaped, language);

			// Show removed lines inline before this line
			if (hasRemovedMarker) {
				const removedContent = removedMarkers.get(lineNum);
				removedContent.forEach((removedLine) => {
					const escapedRemoved = Utils.escapeHtml(removedLine);
					const highlightedRemoved = this._applySyntaxHighlighting(
						escapedRemoved,
						language,
					);
					html += `
						<div class="hv-full-line removed">
							<span class="hv-line-num"></span>
							<span class="hv-line-content">${highlightedRemoved || " "}</span>
						</div>
					`;
				});
			}

			html += `
				<div class="hv-full-line ${lineClass}">
					<span class="hv-line-num">${lineNum}</span>
					<span class="hv-line-content">${highlighted || " "}</span>
				</div>
			`;
		});

		html += `
				</div>
				${scrollbarMarkers}
			</div>
		`;

		return html;
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
				const value = toSelect.value;
				const toVersion = value === "disk" ? "disk" : parseInt(value, 10);
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

		// Copy path button
		const copyBtn = container.querySelector(".hv-copy-path");
		if (copyBtn) {
			copyBtn.addEventListener("click", () => {
				if (this._selectedFile) {
					navigator.clipboard.writeText(this._selectedFile).then(() => {
						copyBtn.textContent = "✓";
						setTimeout(() => {
							copyBtn.textContent = "📋";
						}, 1500);
					});
				}
			});
		}

		// Version navigation
		const prevBtn = container.querySelector(".hv-prev-version");
		if (prevBtn) {
			prevBtn.addEventListener("click", () => {
				this._navigateVersion("prev");
			});
		}

		const nextBtn = container.querySelector(".hv-next-version");
		if (nextBtn) {
			nextBtn.addEventListener("click", () => {
				this._navigateVersion("next");
			});
		}

		// Restore from toolbar
		const restoreToolbarBtn = container.querySelector(
			".hv-restore-toolbar-btn",
		);
		if (restoreToolbarBtn) {
			restoreToolbarBtn.addEventListener("click", () => {
				if (
					this._selectedFile &&
					this._comparisonTo &&
					this._comparisonTo !== "disk"
				) {
					this.showRestorePreview(this._selectedFile, this._comparisonTo);
				}
			});
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

		// Scroll to first change if flag is set
		if (this._shouldScrollToDiff) {
			this._shouldScrollToDiff = false;
			// Use setTimeout to ensure DOM is fully rendered
			setTimeout(() => this._scrollToFirstChange(), 50);
		}
	},

	/**
	 * Scroll the diff viewer to the first changed line
	 * Handles both full view and split view modes
	 */
	_scrollToFirstChange() {
		const container = document.querySelector(".hv-viewer-content");
		if (!container) return;

		// Check if we're in split view mode
		const splitContainer = container.querySelector(".hv-diff-split");
		if (splitContainer) {
			// Split view: scroll both panes to first changed hunk
			const leftPane = splitContainer.querySelector(".hv-split-left");
			const rightPane = splitContainer.querySelector(".hv-split-right");

			// Find the first changed line in each pane
			const leftChange = leftPane?.querySelector(
				".hv-split-line.removed, .hv-split-line.added",
			);
			const rightChange = rightPane?.querySelector(
				".hv-split-line.added, .hv-split-line.removed",
			);

			// Scroll both panes to show the first change
			if (leftChange) {
				leftChange.scrollIntoView({ behavior: "smooth", block: "center" });
			}
			if (rightChange) {
				rightChange.scrollIntoView({ behavior: "smooth", block: "center" });
			}
			return;
		}

		// Full view: find the first changed line
		const firstChange = container.querySelector(
			".hv-full-line.added, .hv-full-line.removed, .hv-line.added, .hv-line.removed",
		);

		if (firstChange) {
			// Scroll the container to show the first change
			firstChange.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	},
};

window.HistoryDiffViewerMixin = HistoryDiffViewerMixin;
