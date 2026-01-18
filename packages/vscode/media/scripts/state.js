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
  versionHistory: {},

  // ==========================================================================
  // UI State
  // ==========================================================================
  currentView: 'dashboard',
  selectedSession: null,
  selectedChange: null,
  selectedFile: null,
  searchQuery: '',
  filters: {
    level: null,
    hook: null,
    session: null
  },

  // ==========================================================================
  // Session View State
  // ==========================================================================
  sessionView: {
    selectedSession: null,
    activeTab: 'activity',  // 'activity' | 'tools' | 'logs'
    autoScroll: true,
    searchQuery: '',
    sessionActivity: [],
    sessionLogs: []
  },

  // ==========================================================================
  // File Changes View State
  // ==========================================================================
  fileChangesView: {
    expandedSessions: [],     // Session IDs that are expanded
    selectedFile: null,       // { sessionId, changeId, filePath }
    viewMode: 'unified'       // 'unified' | 'split'
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
    pendingChanges: 0
  },

  // ==========================================================================
  // Configuration
  // ==========================================================================
  config: {
    autoScroll: true,
    showTimestamps: true,
    maxLogs: 1000
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
      this._listeners.get(key).forEach(callback => {
        try {
          callback(value, oldValue);
        } catch (error) {
          console.error(`[State] Error in listener for ${key}:`, error);
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
    Object.keys(updates).forEach(key => {
      if (this._listeners.has(key)) {
        this._listeners.get(key).forEach(callback => {
          try {
            callback(this[key], oldValues[key]);
          } catch (error) {
            console.error(`[State] Error in listener for ${key}:`, error);
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
      versionHistory: this.versionHistory,
      currentView: this.currentView,
      selectedSession: this.selectedSession,
      selectedChange: this.selectedChange,
      selectedFile: this.selectedFile,
      searchQuery: this.searchQuery,
      filters: { ...this.filters },
      stats: { ...this.stats },
      config: { ...this.config }
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
    this.versionHistory = {};
    this.currentView = 'dashboard';
    this.selectedSession = null;
    this.selectedChange = null;
    this.selectedFile = null;
    this.searchQuery = '';
    this.filters = { level: null, hook: null, session: null };
    this.stats = {
      totalLogs: 0,
      errors: 0,
      warnings: 0,
      blocked: 0,
      logsPerMinute: 0,
      activeSessions: 0,
      pendingChanges: 0
    };
    this.sessionView = {
      selectedSession: null,
      activeTab: 'activity',
      autoScroll: true,
      searchQuery: '',
      sessionActivity: [],
      sessionLogs: []
    };
    this.fileChangesView = {
      expandedSessions: [],
      selectedFile: null,
      viewMode: 'unified'
    };
  }
};

// Make globally available
window.State = State;

// Debug helper - call inspectorDebug() in VS Code dev console
window.inspectorDebug = function() {
  console.log('=== Inspector Hook Debug ===');
  console.log('Connected:', State.connected);
  console.log('Logs count:', State.logs.length);
  console.log('Sessions count:', State.sessions.length);
  console.log('File changes count:', State.fileChanges.length);
  console.log('Stats:', JSON.stringify(State.stats, null, 2));
  if (State.logs.length > 0) {
    console.log('Last log:', JSON.stringify(State.logs[0], null, 2));
  }
  return State.getSnapshot();
};
