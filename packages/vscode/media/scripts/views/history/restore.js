/**
 * History: previewing a restore before applying it.
 *
 * Moved verbatim out of history.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const HistoryRestoreMixin = {
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
};

window.HistoryRestoreMixin = HistoryRestoreMixin;
