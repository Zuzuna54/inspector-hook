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
	_comparisonTo: null, // version number, 'current', or 'disk'
	_viewMode: "full", // 'full' | 'split' (default to full)
	_comparisonDiff: null, // cached diff result
	_diskContent: null, // current on-disk content for comparison

	// Restore preview state
	_restorePreview: null,

	// Loading state
	_loadingComparison: false,
	_shouldScrollToDiff: false, // Scroll to first change after loading

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
		this._viewMode = "full";
		this._restorePreview = null;
		this._comparisonDiff = null;
		this._diskContent = null;
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

};

// Register with Router if available
if (typeof Router !== "undefined" && Router.register) {
	Router.register("history", HistoryView);
}

// Export to window for global access
// Shared with the other diff-rendering view; see scripts/shared/diff-render.js.
// Assigned after the literal so it cannot be shadowed by a stale local copy.
Object.assign(HistoryView, window.DiffRenderMixin);

Object.assign(HistoryView, window.HistoryRestoreMixin);

Object.assign(HistoryView, window.HistoryVersionListMixin);

Object.assign(HistoryView, window.HistoryFileListMixin);

Object.assign(HistoryView, window.HistoryDiffViewerMixin);

Object.assign(HistoryView, window.HistoryVirtualScrollMixin);

Object.assign(HistoryView, window.HistoryDiffRenderMixin);

window.HistoryView = HistoryView;
