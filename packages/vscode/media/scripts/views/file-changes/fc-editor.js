/**
 * File Changes: inline edit mode for a diff before keeping it.
 *
 * Moved verbatim out of file-changes.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const FcEditorMixin = {
	/**
	 * Enter edit mode - makes all added lines editable across all changes
	 */
	enterEditMode() {
		if (!this._selectedFile) return;

		// Store original content and hunks for all current diffs if not already stored
		for (const diffEntry of this._currentDiffs) {
			if (diffEntry.diff && !this._originalContent.has(diffEntry.changeId)) {
				this._originalContent.set(
					diffEntry.changeId,
					diffEntry.diff.afterContent || "",
				);
				// Deep copy hunks so we can restore them on reset/cancel
				this._originalHunks.set(
					diffEntry.changeId,
					JSON.parse(JSON.stringify(diffEntry.diff.hunks || [])),
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
		// Clear stored originals since changes are being kept
		this._originalContent.clear();
		this._originalHunks.clear();
		this._editedContent.clear();

		this._isEditMode = false;
		this.renderDiff();
	},

	/**
	 * Cancel edit mode - discards all edits and restores original content
	 */
	cancelEditMode() {
		if (!this._selectedFile) return;

		// Restore original content and hunks for all changes
		for (const diffEntry of this._currentDiffs) {
			const changeId = diffEntry.changeId;
			const original = this._originalContent.get(changeId);
			const originalHunks = this._originalHunks.get(changeId);

			if (original && diffEntry.diff) {
				// Clear edited content
				this._editedContent.delete(changeId);

				// Restore original content
				diffEntry.diff.afterContent = original;

				// Restore original hunks (deep copy to avoid reference issues)
				if (originalHunks) {
					diffEntry.diff.hunks = JSON.parse(JSON.stringify(originalHunks));
				}

				// Clear cache so it will be re-fetched if needed
				this._diffCache.delete(changeId);

				// Send reset to backend
				if (typeof API !== "undefined" && API.updateChangeContent) {
					API.updateChangeContent(changeId, original);
				}
			}
		}

		// Clear stored originals since we're exiting edit mode
		this._originalContent.clear();
		this._originalHunks.clear();

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
						// IMPORTANT: Also update the hunk line content so re-renders show the edit
						hunkLines[i].content = newLineContent;
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

		// Also update the diff object so re-renders show the edited content
		diff.afterContent = updatedContent;

		// Update cache so subsequent views show edited content
		const cachedDiff = this._diffCache.get(changeId);
		if (cachedDiff) {
			cachedDiff.afterContent = updatedContent;
		}

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

		// Restore original content and hunks for all changes
		for (const diffEntry of this._currentDiffs) {
			const changeId = diffEntry.changeId;
			const original = this._originalContent.get(changeId);
			const originalHunks = this._originalHunks.get(changeId);

			if (original && diffEntry.diff) {
				// Clear edited content
				this._editedContent.delete(changeId);

				// Restore original content
				diffEntry.diff.afterContent = original;

				// Restore original hunks (deep copy to avoid reference issues)
				if (originalHunks) {
					diffEntry.diff.hunks = JSON.parse(JSON.stringify(originalHunks));
				}

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
};

window.FcEditorMixin = FcEditorMixin;
