/**
 * File Changes View - Complete Redesign
 * Sidebar + Full-Width Diff (VS Code Source Control style)
 * Features: Session accordions, per-hunk operations, inline editing, custom modals
 */

const FileChangesView = {
	// ==========================================================================
	// State
	// ==========================================================================

	_subscriptions: [],

	// UI State
	_expandedSessions: new Set(),
	_expandedFiles: new Set(), // filePath keys for expanded file accordions
	_selectedFileKey: null, // "sessionId:filePath" - the currently selected file
	_selectedFile: null, // { sessionId, filePath, changes: [...] } - all changes for selected file
	_viewMode: "unified", // 'unified' (hunks) | 'split'

	// Diff State - now tracks multiple diffs for a file
	_currentDiffs: [], // Array of diff objects for all changes in selected file
	_diffCache: new Map(), // changeId -> diff object
	_pendingDiffLoads: 0, // Counter for pending diff loads

	// Edit State
	_isEditMode: false, // Page-level edit mode (all added lines editable)
	_editedContent: new Map(), // changeId -> modified afterContent
	_originalContent: new Map(), // changeId -> original afterContent (for reset/cancel)
	_originalHunks: new Map(), // changeId -> deep copy of original hunks (for reset/cancel)

	// Scroll State
	_pendingScrollToHunk: null, // { changeId, hunkIndex } to scroll to after diff renders

	// ==========================================================================
	// Initialization
	// ==========================================================================

	/**
	 * Initialize the view
	 */
	init() {
		this._setupSubscriptions();
		this.renderSidebar();
		this.renderEmptyDiff();

		// Request initial data
		if (typeof API !== "undefined" && API.getFileChanges) {
			API.getFileChanges();
		}
	},

	/**
	 * Setup state subscriptions
	 */
	_setupSubscriptions() {
		if (typeof State !== "undefined" && State.subscribe) {
			this._subscriptions.push(
				State.subscribe("fileChanges", () => this.renderSidebar()),
				State.subscribe("sessions", () => this.renderSidebar()),
				State.subscribe("archivedChanges", () => this._updateArchiveCount()),
			);
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
		this._expandedSessions.clear();
		this._expandedFiles.clear();
		this._selectedFileKey = null;
		this._selectedFile = null;
		this._currentDiffs = [];
		this._diffCache.clear();
		this._pendingDiffLoads = 0;
		this._isEditMode = false;
		this._editedContent.clear();
		this._originalContent.clear();
		this._originalHunks.clear();
		this._pendingScrollToHunk = null;
	},

	// ==========================================================================
	// Data Helpers
	// ==========================================================================

};

// Register with Router if available
if (typeof Router !== "undefined" && Router.register) {
	Router.register("file-changes", FileChangesView);
}

// Export to window for global access
// Shared with the other diff-rendering view; see scripts/shared/diff-render.js.
// Assigned after the literal so it cannot be shadowed by a stale local copy.
Object.assign(FileChangesView, window.DiffRenderMixin);

Object.assign(FileChangesView, window.FcActionsMixin);

Object.assign(FileChangesView, window.FcEditorMixin);

Object.assign(FileChangesView, window.FcSessionListMixin);

Object.assign(FileChangesView, window.FcDiffViewMixin);

window.FileChangesView = FileChangesView;
