/**
 * Version history senders.
 *
 * Second domain out of api.js, which the size guard caught growing again. Pure
 * `send()` wrappers with no shared state, composed onto API after the literal.
 */

const HistoryApiMixin = {
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
};

window.HistoryApiMixin = HistoryApiMixin;
