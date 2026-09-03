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
    if (typeof State !== 'undefined' && State.archivedChanges) {
      return State.archivedChanges;
    }
    return [];
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
   * Render the session accordions
   */
  renderSessionAccordions() {
    const container = document.getElementById('arc-sessions');
    if (!container) return;

    const changes = this._getFilteredChanges();

    // Update count
    const countEl = document.getElementById('arc-total-count');
    if (countEl) {
      countEl.textContent = `${changes.length} change${changes.length !== 1 ? 's' : ''}`;
    }

    if (changes.length === 0) {
      const filterText = this.filter === 'all' ? '' : ` ${this.filter}`;
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No${filterText} archived changes</div>
          <div class="empty-state-description">
            ${this._searchQuery ? 'Try a different search term' : 'Archived changes will appear here'}
          </div>
        </div>
      `;
      return;
    }

    const sessionGroups = this._groupBySession(changes);
    const sessions = State.sessions || [];

    // Sort sessions by most recent first
    const sortedSessionIds = Object.keys(sessionGroups).sort((a, b) => {
      const sessionA = sessions.find(s => s.id === a);
      const sessionB = sessions.find(s => s.id === b);
      const timeA = sessionA?.startTime || 0;
      const timeB = sessionB?.startTime || 0;
      return new Date(timeB) - new Date(timeA);
    });

    container.innerHTML = sortedSessionIds.map(sessionId => {
      const sessionChanges = sessionGroups[sessionId];
      const session = sessions.find(s => s.id === sessionId) || {};
      const isExpanded = this._expandedSessions.has(sessionId);
      const fileGroups = this._groupByFile(sessionChanges);
      const fileCount = Object.keys(fileGroups).length;

      // Count kept vs reverted
      const keptCount = sessionChanges.filter(c => c.resolution === 'kept').length;
      const revertedCount = sessionChanges.filter(c => c.resolution === 'reverted').length;

      // Format session age
      const sessionAge = this._formatSessionAge(session.startTime || sessionChanges[0]?.resolvedAt);

      return `
        <div class="arc-session ${isExpanded ? 'expanded' : ''}" data-session-id="${sessionId}">
          <div class="arc-session-header" data-session-id="${sessionId}">
            <span class="arc-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="arc-session-name">${Utils.escapeHtml(session.name || sessionId.slice(0, 8))}</span>
            <span class="arc-session-meta">${sessionAge}</span>
            <span class="arc-session-stats">
              ${fileCount} file${fileCount !== 1 ? 's' : ''}
              <span class="arc-stat-kept" title="Kept">${keptCount}</span>
              <span class="arc-stat-reverted" title="Reverted">${revertedCount}</span>
            </span>
          </div>
          <div class="arc-session-content ${isExpanded ? '' : 'hidden'}">
            ${this._renderFileAccordions(fileGroups, sessionId)}
          </div>
        </div>
      `;
    }).join('');

    this._setupSessionHandlers(container);
  },

  /**
   * Format session age
   */
  _formatSessionAge(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  },

  /**
   * Render file accordions within a session
   */
  _renderFileAccordions(fileGroups, sessionId) {
    return Object.entries(fileGroups).map(([filePath, fileChanges]) => {
      const fileKey = `${sessionId}:${filePath}`;
      const isExpanded = this._expandedFiles.has(fileKey);
      const fileName = Utils.getFileName(filePath);
      const changeCount = fileChanges.length;

      // Get the first change to display
      const primaryChange = fileChanges[0];

      // Determine file resolution status
      const keptCount = fileChanges.filter(c => c.resolution === 'kept').length;
      const revertedCount = fileChanges.filter(c => c.resolution === 'reverted').length;
      const allKept = keptCount === fileChanges.length;
      const allReverted = revertedCount === fileChanges.length;
      const resolution = allKept ? 'kept' : allReverted ? 'reverted' : 'mixed';

      return `
        <div class="arc-file ${isExpanded ? 'expanded' : ''} ${resolution}" data-file-key="${fileKey}">
          <div class="arc-file-header" data-file-key="${fileKey}" data-change-id="${primaryChange.id}">
            <span class="arc-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="arc-resolution-badge ${resolution}">${resolution}</span>
            <span class="arc-file-name" title="${Utils.escapeHtml(filePath)}">${Utils.escapeHtml(fileName)}</span>
            <span class="arc-file-path">${Utils.escapeHtml(Utils.getDirectory(filePath))}</span>
            <span class="arc-change-count">${changeCount} change${changeCount !== 1 ? 's' : ''}</span>
            ${allReverted ? `
              <div class="arc-file-actions">
                <button class="btn btn-xs btn-warning arc-file-restore" data-file-key="${fileKey}">Restore ${changeCount > 1 ? `all ${changeCount}` : ''}</button>
              </div>
            ` : ''}
          </div>
          <div class="arc-file-content ${isExpanded ? '' : 'hidden'}" data-change-id="${primaryChange.id}">
            ${isExpanded ? this._renderChangeList(fileChanges) : '<div class="arc-loading">Loading...</div>'}
          </div>
        </div>
      `;
    }).join('');
  },

  /**
   * Render the list of changes for a file
   */
  _renderChangeList(changes) {
    if (!changes || changes.length === 0) {
      return '<div class="arc-empty">No changes</div>';
    }

    return `
      <div class="arc-changes">
        ${changes.map(change => this._renderChangeItem(change)).join('')}
      </div>
    `;
  },

  /**
   * Render a single change item
   */
  _renderChangeItem(change) {
    const isSelected = this._selectedChangeId === change.id;
    const resolution = change.resolution || 'unknown';
    const time = Utils.formatTime(change.resolvedAt || change.timestamp);
    const tool = change.toolName || 'unknown';

    return `
      <div class="arc-change ${resolution} ${isSelected ? 'selected' : ''}" data-change-id="${change.id}">
        <div class="arc-change-header" data-change-id="${change.id}">
          <span class="arc-change-badge ${resolution}">${resolution}</span>
          <span class="arc-change-tool">${Utils.escapeHtml(tool)}</span>
          <span class="arc-change-time">${time}</span>
          <div class="arc-change-actions">
            <button class="btn btn-xs btn-view arc-change-view" data-change-id="${change.id}">View</button>
            ${resolution === 'reverted' ? `
              <button class="btn btn-xs btn-warning arc-change-restore" data-change-id="${change.id}">Restore</button>
            ` : ''}
          </div>
        </div>
        ${isSelected && this._currentDiff ? this._renderDiffPreview() : ''}
      </div>
    `;
  },

  /**
   * Render diff preview
   */
  _renderDiffPreview() {
    const diff = this._currentDiff;
    if (!diff) return '';

    return `
      <div class="arc-diff-preview">
        <div class="arc-diff-stats">
          <span class="arc-additions">+${diff.additions || 0}</span>
          <span class="arc-deletions">-${diff.deletions || 0}</span>
        </div>
        <div class="arc-diff-content">
          ${(diff.hunks || []).map(hunk => this._renderHunkPreview(hunk)).join('')}
        </div>
      </div>
    `;
  },

  /**
   * Render hunk preview
   */
  _renderHunkPreview(hunk) {
    return `
      <div class="arc-hunk">
        <div class="arc-hunk-header">
          @@ -${hunk.oldStart || 0},${hunk.oldLines || 0} +${hunk.newStart || 0},${hunk.newLines || 0} @@
        </div>
        <div class="arc-hunk-lines">
          ${(hunk.lines || []).slice(0, 10).map(line => {
            const lineType = line.type || 'context';
            const prefix = lineType === 'added' ? '+' : lineType === 'removed' ? '-' : ' ';
            return `
              <div class="arc-line ${lineType}">
                <span class="arc-line-prefix">${prefix}</span>
                <span class="arc-line-content">${Utils.escapeHtml(line.content || '')}</span>
              </div>
            `;
          }).join('')}
          ${(hunk.lines || []).length > 10 ? `<div class="arc-line-more">... ${(hunk.lines || []).length - 10} more lines</div>` : ''}
        </div>
      </div>
    `;
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
      // Request diff
      if (typeof API !== 'undefined' && API.getDiff) {
        API.getDiff(changeId);
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

// Register with Router if available
if (typeof Router !== 'undefined' && Router.register) {
  Router.register('archived', ArchivedView);
}

// Export to window for global access
window.ArchivedView = ArchivedView;
