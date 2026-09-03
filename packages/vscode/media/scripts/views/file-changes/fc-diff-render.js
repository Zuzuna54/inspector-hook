/**
 * File Changes: the diff renderers - hunks, unified and split layouts, line numbers.
 *
 * Separated from fc-diff-view.js, which keeps the orchestration: which diff is
 * shown, its loading and error states, and the handlers.
 *
 * Composed onto the view with Object.assign, so `this` resolves to the view
 * exactly as it did when these were declared inline.
 */

const FcDiffRenderMixin = {
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
};

window.FcDiffRenderMixin = FcDiffRenderMixin;
