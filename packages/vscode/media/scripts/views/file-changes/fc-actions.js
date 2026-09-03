/**
 * File Changes: keep and revert actions, and their confirmation modal.
 *
 * Moved verbatim out of file-changes.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const FcActionsMixin = {
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

window.FcActionsMixin = FcActionsMixin;
