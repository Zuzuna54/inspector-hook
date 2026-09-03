/**
 * History: the version list for one file, and its lazy content cache.
 *
 * Moved verbatim out of history.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const HistoryVersionListMixin = {
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
						const isSelected =
							this._selectedFile === filePath &&
							this._comparisonTo === version.versionNumber;

						return `
            <div class="hv-version ${isCurrent ? "current" : ""} ${isSelected ? "selected" : ""}"
                 data-file-path="${Utils.escapeHtml(filePath)}"
                 data-version="${version.versionNumber}">
              <span class="hv-version-num">v${version.versionNumber}</span>
              <span class="hv-version-time">${this._formatShortTime(version.timestamp)}</span>
              ${isCurrent ? '<span class="hv-current-marker">💾</span>' : ""}
              <div class="hv-version-actions">
                ${!isCurrent ? `<button class="btn btn-xs btn-warning hv-restore-btn" data-file-path="${Utils.escapeHtml(filePath)}" data-version="${version.versionNumber}" title="Restore">↩</button>` : ""}
                ${versions.length > 1 ? `<button class="btn btn-xs btn-danger hv-delete-btn" data-file-path="${Utils.escapeHtml(filePath)}" data-version="${version.versionNumber}" title="Delete">🗑</button>` : ""}
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
	 * Select a specific version for viewing
	 */
	_selectVersion(filePath, versionNumber) {
		const versionHistory = this._getVersionHistory();
		const versions = versionHistory[filePath] || [];
		const sortedVersions = [...versions].sort(
			(a, b) => b.versionNumber - a.versionNumber,
		);

		// Find the version's position and set from/to
		const versionIdx = sortedVersions.findIndex(
			(v) => v.versionNumber === versionNumber,
		);

		if (versionIdx >= 0) {
			this._comparisonTo = versionNumber;
			// Set from to the previous version (if exists)
			if (versionIdx < sortedVersions.length - 1) {
				this._comparisonFrom = sortedVersions[versionIdx + 1].versionNumber;
			} else {
				this._comparisonFrom = versionNumber; // Single version
			}
			// Set flag to scroll to first change after loading
			this._shouldScrollToDiff = true;
			this._loadComparison(filePath);
			this.renderFileAccordions();
		}
	},

	/**
	 * Confirm and delete a version
	 */
	_confirmDeleteVersion(filePath, versionNumber) {
		const confirmed = confirm(
			`Delete version ${versionNumber} of ${Utils.getFileName(filePath)}?\n\nThis action cannot be undone.`,
		);

		if (confirmed) {
			API.deleteVersion(filePath, versionNumber);
		}
	},

	/**
	 * Navigate to previous or next version
	 */
	_navigateVersion(direction) {
		const versionHistory = this._getVersionHistory();
		const versions = versionHistory[this._selectedFile] || [];

		if (versions.length < 2) return;

		const sortedVersions = [...versions].sort(
			(a, b) => b.versionNumber - a.versionNumber,
		);

		// Find current position
		let currentIdx;
		if (this._comparisonTo === "disk") {
			currentIdx = -1; // Disk is "before" all versions
		} else {
			currentIdx = sortedVersions.findIndex(
				(v) => v.versionNumber === this._comparisonTo,
			);
		}

		let newIdx;
		if (direction === "prev") {
			// Go to older version (higher index)
			newIdx = Math.min(currentIdx + 1, sortedVersions.length - 1);
		} else {
			// Go to newer version (lower index)
			if (currentIdx === 0) {
				// Already at newest, can go to disk
				this._comparisonTo = "disk";
				this._comparisonFrom = sortedVersions[0].versionNumber;
				this._loadComparison(this._selectedFile);
				return;
			}
			newIdx = Math.max(currentIdx - 1, 0);
		}

		if (newIdx !== currentIdx && newIdx >= 0) {
			this._comparisonTo = sortedVersions[newIdx].versionNumber;
			// Set from to the version before to
			if (newIdx < sortedVersions.length - 1) {
				this._comparisonFrom = sortedVersions[newIdx + 1].versionNumber;
			}
			this._loadComparison(this._selectedFile);
		}
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
};

window.HistoryVersionListMixin = HistoryVersionListMixin;
