/**
 * History: the diff renderers - unified, split, hunk lines and full content.
 *
 * Separated from diff-viewer.js, which keeps the viewer orchestration: the
 * comparison toolbar, loading a comparison, and the handlers.
 *
 * Composed onto the view with Object.assign, so `this` resolves to the view
 * exactly as it did when these were declared inline.
 */

const HistoryDiffRenderMixin = {
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
};

window.HistoryDiffRenderMixin = HistoryDiffRenderMixin;
