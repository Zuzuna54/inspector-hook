/**
 * File Changes: rendering a diff - unified, split, hunks and line numbers.
 *
 * Moved verbatim out of file-changes.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const FcDiffViewMixin = {
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
      <button class="btn btn-xs btn-warning fc-edit-reset" title="Reset all edits to original">Reset</button>
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
        <button class="${this._viewMode === "unified" ? "active" : ""}" data-mode="unified" ${this._isEditMode ? "disabled" : ""}>Hunks</button>
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
		} else if (this._viewMode === "unified") {
			// Unified hunks view - shows only changed hunks
			container.innerHTML = this._renderAllChangesUnified(filePath);
		} else {
			// Split view - side by side
			container.innerHTML = this._renderAllChangesSplit(filePath);
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

		// Show Keep/Revert buttons only when NOT in edit mode
		const actionButtons = isEditing
			? ""
			: `
          <div class="fc-hunk-actions">
            <button class="btn btn-xs btn-success fc-hunk-keep" data-change-id="${changeId}" title="Keep">Keep</button>
            <button class="btn btn-xs btn-danger fc-hunk-revert" data-change-id="${changeId}" title="Revert">Revert</button>
          </div>`;

		return `
      <div class="fc-hunk-card ${isEditing ? "editing" : ""}" data-change-id="${changeId}" data-hunk-index="${hunkIndex}">
        <div class="fc-hunk-header">
          <span class="fc-hunk-info">@@ -${oldStart},${oldLines} +${newStart},${newLines} @@</span>
          <span class="fc-tool-badge ${toolType} small">${Utils.escapeHtml(change.tool || "unknown")}</span>
          <span class="fc-hunk-time">${Utils.formatTime(change.timestamp)}</span>
          ${actionButtons}
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

		// Toolbar Reset button - reset all edits to original (stay in edit mode)
		toolbar?.querySelector(".fc-edit-reset")?.addEventListener("click", () => {
			this.resetAllEdits();
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
};

window.FcDiffViewMixin = FcDiffViewMixin;
