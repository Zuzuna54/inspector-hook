/**
 * Centralized State Management
 * Provides reactive state with subscription support
 */

const State = {
	// ==========================================================================
	// Connection State
	// ==========================================================================
	connected: false,
	port: null,

	// ==========================================================================
	// Data
	// ==========================================================================
	logs: [],
	sessions: [],
	fileChanges: [],
	archivedChanges: [],
	trackedFiles: [],
	versionHistory: {},

	// ==========================================================================
	// UI State
	// ==========================================================================
	currentView: "dashboard",
	selectedSession: null,
	selectedChange: null,
	selectedFile: null,
	searchQuery: "",
	filters: {
		level: null,
		hook: null,
		session: null,
	},

	// ==========================================================================
	// Session View State
	// ==========================================================================
	sessionView: {
		selectedSession: null,
		activeTab: "activity", // 'activity' | 'tools' | 'logs'
		autoScroll: true,
		searchQuery: "",
		sessionActivity: [],
		sessionLogs: [],
		// Set from the activity response: whether older logs exist beyond the
		// fetched window, and how many the core still retains for the session.
		// Retained, not lifetime - activity reads are served from memory.
		activityTruncated: false,
		activityAvailableLogs: null,
		// Cursor for incremental activity polling. Null means "fetch the whole
		// window"; after the first response it holds the server's nextSince.
		activitySince: null,
		activityHasMore: false,
	},

	// ==========================================================================
	// Context View State (M3 - native auto memory)
	// ==========================================================================
	contextView: {
		projects: [],
		selectedProject: null,   // memoryDir, which is the stable key
		selectedFile: null,      // fileName within the selected project
		// Eight of eighteen projects in a real corpus hold no memory; listing
		// them by default buries the ones that do.
		showEmpty: false,
		// The last write/delete/index result, so a refusal can be rendered in
		// the backend's own words rather than paraphrased.
		lastResult: null,
		// "memory" browses and curates the corpus; "injection" is the explicit
		// picker and the digest preview. Two jobs, one view.
		mode: "memory",
		// Cross-project search. Native memory is per-project, so searching the
		// whole corpus is the thing no editor and no session can do.
		search: "",
		// The file being edited, and its working copy.
		editing: null,
		draft: "",
		// Context staged for the next session, and a previewed digest.
		staged: null,
		digest: null,
	},

	// ==========================================================================
	// File Changes View State
	// ==========================================================================
	fileChangesView: {
		expandedSessions: [], // Session IDs that are expanded
		selectedFile: null, // { sessionId, changeId, filePath }
		viewMode: "unified", // 'unified' | 'split'
	},

	// ==========================================================================
	// Stats
	// ==========================================================================
	stats: {
		totalLogs: 0,
		errors: 0,
		warnings: 0,
		blocked: 0,
		logsPerMinute: 0,
		activeSessions: 0,
		pendingChanges: 0,
	},

	// ==========================================================================
	// Configuration
	// ==========================================================================
	config: {
		autoScroll: true,
		showTimestamps: true,
		maxLogs: 1000,
	},

	// ==========================================================================
	// Subscription System
	// ==========================================================================
	_listeners: new Map(),

	/**
	 * Subscribe to state changes for a specific key
	 * @param {string} key - State key to subscribe to
	 * @param {Function} callback - Callback function receiving new value
	 * @returns {Function} Unsubscribe function
	 */
	subscribe(key, callback) {
		if (!this._listeners.has(key)) {
			this._listeners.set(key, new Set());
		}
		this._listeners.get(key).add(callback);

		// Return unsubscribe function
		return () => {
			const listeners = this._listeners.get(key);
			if (listeners) {
				listeners.delete(callback);
				if (listeners.size === 0) {
					this._listeners.delete(key);
				}
			}
		};
	},

	/**
	 * Update a single state key and notify listeners
	 * @param {string} key - State key to update
	 * @param {*} value - New value
	 */
	update(key, value) {
		const oldValue = this[key];
		this[key] = value;

		// Notify listeners
		if (this._listeners.has(key)) {
			this._listeners.get(key).forEach((callback) => {
				try {
					callback(value, oldValue);
				} catch (_error) {
					// Listener error - silently ignore
				}
			});
		}
	},

	/**
	 * Batch update multiple state keys
	 * @param {Object} updates - Object with key-value pairs to update
	 */
	batchUpdate(updates) {
		const oldValues = {};

		// Update all values first
		Object.entries(updates).forEach(([key, value]) => {
			oldValues[key] = this[key];
			this[key] = value;
		});

		// Then notify listeners
		Object.keys(updates).forEach((key) => {
			if (this._listeners.has(key)) {
				this._listeners.get(key).forEach((callback) => {
					try {
						callback(this[key], oldValues[key]);
					} catch (_error) {
						// Listener error - silently ignore
					}
				});
			}
		});
	},

	/**
	 * Get current state snapshot
	 * @returns {Object} State snapshot
	 */
	getSnapshot() {
		return {
			connected: this.connected,
			port: this.port,
			logs: this.logs,
			sessions: this.sessions,
			fileChanges: this.fileChanges,
			archivedChanges: this.archivedChanges,
			trackedFiles: this.trackedFiles,
			versionHistory: this.versionHistory,
			currentView: this.currentView,
			selectedSession: this.selectedSession,
			selectedChange: this.selectedChange,
			selectedFile: this.selectedFile,
			searchQuery: this.searchQuery,
			filters: { ...this.filters },
			stats: { ...this.stats },
			config: { ...this.config },
		};
	},

	/**
	 * Reset state to defaults
	 */
	reset() {
		this.connected = false;
		this.port = null;
		this.logs = [];
		this.sessions = [];
		this.fileChanges = [];
		this.archivedChanges = [];
		this.trackedFiles = [];
		this.versionHistory = {};
		this.currentView = "dashboard";
		this.selectedSession = null;
		this.selectedChange = null;
		this.selectedFile = null;
		this.searchQuery = "";
		this.filters = { level: null, hook: null, session: null };
		this.stats = {
			totalLogs: 0,
			errors: 0,
			warnings: 0,
			blocked: 0,
			logsPerMinute: 0,
			activeSessions: 0,
			pendingChanges: 0,
		};
		this.sessionView = {
			selectedSession: null,
			activeTab: "activity",
			autoScroll: true,
			searchQuery: "",
			sessionActivity: [],
			sessionLogs: [],
			activityTruncated: false,
			activityAvailableLogs: null,
			activitySince: null,
			activityHasMore: false,
		};
		this.contextView = {
			projects: [],
			selectedProject: null,
			selectedFile: null,
			showEmpty: false,
			lastResult: null,
			mode: "memory",
			search: "",
			editing: null,
			draft: "",
			staged: null,
			digest: null,
		};
		this.fileChangesView = {
			expandedSessions: [],
			selectedFile: null,
			viewMode: "unified",
		};
	},
};

// Make globally available
window.State = State;

// Debug helper - call inspectorDebug() in VS Code dev console
window.inspectorDebug = () => {
	return State.getSnapshot();
};
