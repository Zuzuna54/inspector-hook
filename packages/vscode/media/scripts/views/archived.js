/**
 * Archived View - v2 Redesign
 * Session > File > Changes accordion structure (matching File Changes view)
 * Shows archived/resolved changes with restore functionality
 */

const ArchivedView = {
  filter: 'all', // 'all', 'kept', 'reverted'
  _subscriptions: [],

  // Accordion state
  _expandedSessions: new Set(),
  _expandedFiles: new Set(),

  // Current diff
  _currentDiff: null,
  _selectedChangeId: null,

  // Search filter
  _searchQuery: '',

  /**
   * Initialize the view
   */
  init() {
  	// The global project filter scopes this view, so a change has to
  	// redraw it — otherwise the list keeps the previous scope while the
  	// header says something else.
  	if (typeof State !== 'undefined' && State.subscribe) {
  		const off = State.subscribe('projectFilter', (next, prev) => {
  			if (prev && next.selectedId === prev.selectedId) return;
  			this.render();
  		});
  		if (this._unsubscribers) this._unsubscribers.push(off);
  	}
    this.render();

    // Subscribe to state changes
    if (typeof State !== 'undefined' && State.subscribe) {
      this._subscriptions.push(
        State.subscribe('archivedChanges', () => this.renderSessionAccordions())
      );
      // This view used to subscribe to a State key named for the current diff.
      // Nothing ever wrote that key, so the handler could never fire and the
      // diff preview was unreachable. Diffs now arrive through
      // API.handleMessage, which routes diff-result to whichever view is
      // active - see handleDiffResult below.
    }

    // Request initial data
    if (typeof API !== 'undefined' && API.getArchivedChanges) {
      API.getArchivedChanges();
    }
  },

  /**
   * Cleanup subscriptions when view is deactivated
   */
  cleanup() {
    this._subscriptions.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this._subscriptions = [];
    this.filter = 'all';
    this._expandedSessions.clear();
    this._expandedFiles.clear();
    this._currentDiff = null;
    this._selectedChangeId = null;
    this._searchQuery = '';
  },

  /**
   * Render the main view structure
   */
  render() {
    const container = document.getElementById('view-archived');
    if (!container) return;

    container.innerHTML = `
      <div class="archived-v2">
        <div class="arc-header">
          <div class="arc-header-left">
            <h3>Archived Changes</h3>
            <span class="arc-count" id="arc-total-count">0 changes</span>
          </div>
          <div class="arc-header-right">
            <input type="text" class="input arc-search" id="arc-search" placeholder="Filter files..." />
            <div class="arc-filters" id="arc-filters">
              <button class="filter-btn ${this.filter === 'all' ? 'active' : ''}" data-filter="all">All</button>
              <button class="filter-btn ${this.filter === 'kept' ? 'active' : ''}" data-filter="kept">Kept</button>
              <button class="filter-btn ${this.filter === 'reverted' ? 'active' : ''}" data-filter="reverted">Reverted</button>
            </div>
          </div>
        </div>
        <div class="arc-content">
          <div class="arc-sessions" id="arc-sessions">
            <div class="empty-state">Loading archived changes...</div>
          </div>
        </div>
      </div>
    `;

    this._setupGlobalHandlers();
    this.renderSessionAccordions();
  },

  /**
   * Set up global event handlers
   */
  _setupGlobalHandlers() {
    // Search input
    const searchInput = document.getElementById('arc-search');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        this._searchQuery = e.target.value.toLowerCase().trim();
        this.renderSessionAccordions();
      }, 200));
    }

    // Filter buttons
    const filtersContainer = document.getElementById('arc-filters');
    if (filtersContainer) {
      filtersContainer.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.filter = btn.dataset.filter;

          // Update active state
          filtersContainer.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === this.filter);
          });

          this.renderSessionAccordions();
        });
      });
    }
  },

  /**
   * Get archived changes from state
   */
  _getArchivedChanges() {
    if (typeof State === 'undefined' || !State.archivedChanges) return [];
    // The global project filter. Three-valued: a change whose path the core
    // could not place is KEPT, not dropped -- a scoped list that is silently
    // shorter than the truth reads as "this project has fewer changes".
    const identity =
      typeof ProjectFilter !== 'undefined' ? ProjectFilter.selected() : null;
    if (!identity) {
      this._unattributed = 0;
      return State.archivedChanges;
    }
    const split = ProjectFilter.split(identity, State.archivedChanges, (c) => ({
      path: c.filePath,
    }));
    this._unattributed = split.unknown.length;
    return [...split.included, ...split.unknown];
  },

  /**
   * Get filtered changes based on search and filter
   */
  _getFilteredChanges() {
    let changes = this._getArchivedChanges();

    // Apply resolution filter
    if (this.filter !== 'all') {
      changes = changes.filter(c => c.resolution === this.filter);
    }

    // Apply search filter
    if (this._searchQuery) {
      changes = changes.filter(c => {
        const fileName = Utils.getFileName(c.filePath).toLowerCase();
        const filePath = (c.filePath || '').toLowerCase();
        return fileName.includes(this._searchQuery) || filePath.includes(this._searchQuery);
      });
    }

    return changes;
  },

  /**
   * Group changes by session
   */
  _groupBySession(changes) {
    const groups = {};
    changes.forEach(change => {
      const sessionId = change.sessionId || 'unknown';
      if (!groups[sessionId]) {
        groups[sessionId] = [];
      }
      groups[sessionId].push(change);
    });
    return groups;
  },

  /**
   * Group changes by file within a session
   */
  _groupByFile(changes) {
    const groups = {};
    changes.forEach(change => {
      const filePath = change.filePath || 'unknown';
      if (!groups[filePath]) {
        groups[filePath] = [];
      }
      groups[filePath].push(change);
    });
    return groups;
  },


  /**
   * Set up handlers for session accordions
   */
  _setupSessionHandlers(container) {
    // Session header click - toggle expand
    container.querySelectorAll('.arc-session-header').forEach(header => {
      header.addEventListener('click', () => {
        const sessionId = header.dataset.sessionId;
        this.toggleSession(sessionId);
      });
    });

    // File header click - toggle expand
    container.querySelectorAll('.arc-file-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.arc-file-actions')) return;
        const fileKey = header.dataset.fileKey;
        this.toggleFile(fileKey);
      });
    });

    // File restore button. Previously carried data-change-id set to
    // fileChanges[0].id, so "Restore" on a file with several reverted changes
    // restored only the first and silently left the rest reverted.
    container.querySelectorAll('.arc-file-restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._confirmRestoreFile(btn.dataset.fileKey);
      });
    });

    // Change view button
    container.querySelectorAll('.arc-change-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.viewChange(btn.dataset.changeId);
      });
    });

    // Change restore button
    container.querySelectorAll('.arc-change-restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._confirmRestore(btn.dataset.changeId);
      });
    });

    // Change header click - view diff
    container.querySelectorAll('.arc-change-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.arc-change-actions')) return;
        this.viewChange(header.dataset.changeId);
      });
    });
  },

  /**
   * Toggle session accordion
   */
  toggleSession(sessionId) {
    if (this._expandedSessions.has(sessionId)) {
      this._expandedSessions.delete(sessionId);
    } else {
      this._expandedSessions.add(sessionId);
    }
    this.renderSessionAccordions();
  },

  /**
   * Toggle file accordion
   */
  toggleFile(fileKey) {
    if (this._expandedFiles.has(fileKey)) {
      this._expandedFiles.delete(fileKey);
    } else {
      this._expandedFiles.add(fileKey);
    }
    this.renderSessionAccordions();
  },

  /**
   * View a change's diff
   */
  viewChange(changeId) {
    if (this._selectedChangeId === changeId) {
      // Toggle off
      this._selectedChangeId = null;
      this._currentDiff = null;
    } else {
      this._selectedChangeId = changeId;
      // Request diff from the ARCHIVE. This view lists kept and reverted
      // changes, which the tracker holds in a different map from pending
      // ones -- asking the pending lookup returns null for every one of
      // them, which is what this view did for its whole existence.
      if (typeof API !== 'undefined' && API.getArchivedDiff) {
        API.getArchivedDiff(changeId);
      }
    }
    this.renderSessionAccordions();
  },

  /**
   * Handle a diff result routed here by API.handleMessage.
   * Public because the router calls it by name.
   */
  handleDiffResult(payload) {
    // The payload is the diff itself, or wraps it under `diff`.
    this._currentDiff = payload?.diff || payload || null;
    this._diffError = null;
    this.renderSessionAccordions();
  },

  /**
   * Handle a diff that could not be computed. Without this the preview stayed
   * on "Loading..." forever.
   */
  handleDiffError(payload) {
    this._currentDiff = null;
    this._diffError = payload?.error || payload?.message || 'Could not load diff';
    this.renderSessionAccordions();
  },

  /**
   * Confirm and restore every archived change for one file.
   * @param {string} fileKey
   */
  _confirmRestoreFile(fileKey) {
    const changes = this._changesForFileKey(fileKey);
    if (changes.length === 0) return;

    const what = changes.length === 1
      ? 'this change'
      : `all ${changes.length} changes for this file`;
    if (!confirm(`Restore ${what}? This will re-apply them to the file.`)) return;

    if (typeof API !== 'undefined' && API.restoreArchived) {
      changes.forEach(change => API.restoreArchived(change.id));
    }
  },

  /**
   * Every archived change belonging to one file key.
   *
   * The key is built the same way _renderFileAccordions builds it
   * (`sessionId:filePath`), so a change found here is exactly one of the
   * changes the accordion grouped under that row.
   *
   * @param {string} fileKey
   * @returns {Array}
   */
  _changesForFileKey(fileKey) {
    const all = (typeof State !== 'undefined' && State.archivedChanges) || [];
    return all.filter(
      change => `${change.sessionId}:${change.filePath}` === fileKey
    );
  },

  /**
   * Confirm and execute restore
   */
  _confirmRestore(changeId) {
    if (confirm('Restore this change? This will re-apply the change to the file.')) {
      if (typeof API !== 'undefined' && API.restoreArchived) {
        API.restoreArchived(changeId);
      }
    }
  }
};

// Rendering lives in ./archived/archived-render.js. Composed here so `this`
// is still the view — a missing module is then a load-time absence rather
// than a silently undefined method at click time.
if (typeof window !== 'undefined' && window.ArchivedRenderMixin) {
  Object.assign(ArchivedView, window.ArchivedRenderMixin);
}

// Register with Router if available
if (typeof Router !== 'undefined' && Router.register) {
  Router.register('archived', ArchivedView);
}

// Export to window for global access
window.ArchivedView = ArchivedView;
