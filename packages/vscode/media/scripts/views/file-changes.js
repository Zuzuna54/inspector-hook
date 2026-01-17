/**
 * File Changes View - Complete Redesign
 * Session > File > Changes accordion structure with per-hunk operations
 */

const FileChangesView = {
  currentDiff: null,
  selectedChangeId: null,
  _subscriptions: [],

  // Accordion state
  _expandedSessions: new Set(),
  _expandedFiles: new Set(),
  _selectedHunks: new Set(),

  // Current hunk navigation
  _currentHunkIndex: 0,
  _totalHunks: 0,

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
        State.subscribe('fileChanges', () => this.renderSessionAccordions())
      );
      this._subscriptions.push(
        State.subscribe('currentDiff', (diff) => this.showDiff(diff))
      );
      this._subscriptions.push(
        State.subscribe('filters', () => this.renderSessionAccordions())
      );
    }

    // Request initial data
    if (typeof API !== 'undefined' && API.getFileChanges) {
      API.getFileChanges();
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
    this.currentDiff = null;
    this.selectedChangeId = null;
    this._expandedSessions.clear();
    this._expandedFiles.clear();
    this._selectedHunks.clear();
    this._searchQuery = '';
  },

  /**
   * Render the main view structure
   */
  render() {
    const container = document.getElementById('view-file-changes');
    if (!container) return;

    container.innerHTML = `
      <div class="file-changes-v2">
        <div class="fc-header">
          <div class="fc-header-left">
            <h3>Pending Changes</h3>
            <span class="fc-count" id="fc-total-count">0 changes</span>
          </div>
          <div class="fc-header-right">
            <input type="text" class="input fc-search" id="fc-search" placeholder="Filter files..." />
            <div class="btn-group">
              <button class="btn btn-sm btn-success" id="fc-keep-all">Keep All</button>
              <button class="btn btn-sm btn-danger" id="fc-revert-all">Revert All</button>
            </div>
          </div>
        </div>
        <div class="fc-content">
          <div class="fc-sessions" id="fc-sessions">
            <div class="empty-state">Loading changes...</div>
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
    const searchInput = document.getElementById('fc-search');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        this._searchQuery = e.target.value.toLowerCase().trim();
        this.renderSessionAccordions();
      }, 200));
    }

    // Keep all button
    const keepAllBtn = document.getElementById('fc-keep-all');
    if (keepAllBtn) {
      keepAllBtn.addEventListener('click', () => {
        const changes = this._getFilteredChanges();
        if (changes.length === 0) return;
        if (confirm(`Keep all ${changes.length} pending changes?`)) {
          API.keepAllChanges();
        }
      });
    }

    // Revert all button
    const revertAllBtn = document.getElementById('fc-revert-all');
    if (revertAllBtn) {
      revertAllBtn.addEventListener('click', () => {
        const changes = this._getFilteredChanges();
        if (changes.length === 0) return;
        if (confirm(`Revert all ${changes.length} pending changes? This cannot be undone.`)) {
          API.revertAllChanges();
        }
      });
    }
  },

  /**
   * Get file changes from state
   */
  _getFileChanges() {
    if (typeof State !== 'undefined' && State.fileChanges) {
      return State.fileChanges;
    }
    return [];
  },

  /**
   * Get filtered changes based on search and session filter
   */
  _getFilteredChanges() {
    let changes = this._getFileChanges();

    // Apply session filter if set
    if (typeof State !== 'undefined' && State.filters?.session) {
      changes = changes.filter(c => c.sessionId === State.filters.session);
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
    const container = document.getElementById('fc-sessions');
    if (!container) return;

    const changes = this._getFilteredChanges();

    // Update count
    const countEl = document.getElementById('fc-total-count');
    if (countEl) {
      countEl.textContent = `${changes.length} change${changes.length !== 1 ? 's' : ''}`;
    }

    if (changes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No pending changes</div>
          <div class="empty-state-description">
            ${this._searchQuery ? 'Try a different search term' : 'File changes will appear here'}
          </div>
        </div>
      `;
      return;
    }

    const sessionGroups = this._groupBySession(changes);
    const sessions = State.sessions || [];

    container.innerHTML = Object.entries(sessionGroups).map(([sessionId, sessionChanges]) => {
      const session = sessions.find(s => s.id === sessionId) || {};
      const isExpanded = this._expandedSessions.has(sessionId);
      const fileGroups = this._groupByFile(sessionChanges);
      const fileCount = Object.keys(fileGroups).length;
      const toolCount = session.toolCount || 0;
      const duration = Utils.formatDuration(session.startTime, session.endTime) || '';

      return `
        <div class="fc-session ${isExpanded ? 'expanded' : ''}" data-session-id="${sessionId}">
          <div class="fc-session-header" data-session-id="${sessionId}">
            <span class="fc-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="fc-session-name">${Utils.escapeHtml(session.name || sessionId.slice(0, 8))}</span>
            <span class="fc-session-meta">${duration ? duration + ' ago' : ''}</span>
            <span class="fc-session-stats">${toolCount} tools | ${fileCount} files</span>
            <div class="fc-session-actions">
              <button class="btn btn-xs btn-success fc-session-keep" data-session-id="${sessionId}">Keep All</button>
              <button class="btn btn-xs btn-danger fc-session-revert" data-session-id="${sessionId}">Revert All</button>
            </div>
          </div>
          <div class="fc-session-content ${isExpanded ? '' : 'hidden'}">
            ${this._renderFileAccordions(fileGroups, sessionId)}
          </div>
        </div>
      `;
    }).join('');

    this._setupSessionHandlers(container);
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

      // Get the first change to display diff
      const primaryChange = fileChanges[0];

      return `
        <div class="fc-file ${isExpanded ? 'expanded' : ''}" data-file-key="${fileKey}">
          <div class="fc-file-header" data-file-key="${fileKey}" data-change-id="${primaryChange.id}">
            <span class="fc-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="fc-file-name" title="${Utils.escapeHtml(filePath)}">${Utils.escapeHtml(fileName)}</span>
            <span class="fc-file-path">${Utils.escapeHtml(Utils.getDirectory(filePath))}</span>
            <span class="fc-change-count">${changeCount} hunk${changeCount !== 1 ? 's' : ''}</span>
            <div class="fc-file-actions">
              <button class="btn btn-xs btn-success fc-file-keep" data-change-id="${primaryChange.id}">Keep</button>
              <button class="btn btn-xs btn-danger fc-file-revert" data-change-id="${primaryChange.id}">Revert</button>
            </div>
          </div>
          <div class="fc-file-content ${isExpanded ? '' : 'hidden'}" data-change-id="${primaryChange.id}">
            ${isExpanded ? this._renderFileDiff(primaryChange) : '<div class="fc-diff-loading">Loading diff...</div>'}
          </div>
        </div>
      `;
    }).join('');
  },

  /**
   * Render the diff for a file
   */
  _renderFileDiff(change) {
    if (!this.currentDiff || this.selectedChangeId !== change.id) {
      // Request diff if not loaded
      API.getDiff(change.id);
      this.selectedChangeId = change.id;
      return '<div class="fc-diff-loading">Loading diff...</div>';
    }

    const diff = this.currentDiff;
    if (!diff.hunks || diff.hunks.length === 0) {
      return '<div class="fc-diff-empty">No changes</div>';
    }

    const language = Utils.detectLanguage(change.filePath, diff.afterContent || '');
    this._totalHunks = diff.hunks.length;

    return `
      <div class="fc-diff-viewer">
        <div class="fc-diff-toolbar">
          <div class="fc-hunk-nav">
            <button class="btn btn-xs fc-nav-prev" ${this._currentHunkIndex <= 0 ? 'disabled' : ''}>Prev</button>
            <span class="fc-hunk-position">Hunk ${this._currentHunkIndex + 1}/${this._totalHunks}</span>
            <button class="btn btn-xs fc-nav-next" ${this._currentHunkIndex >= this._totalHunks - 1 ? 'disabled' : ''}>Next</button>
          </div>
          <div class="fc-diff-stats">
            <span class="fc-additions">+${diff.additions || 0}</span>
            <span class="fc-deletions">-${diff.deletions || 0}</span>
          </div>
        </div>
        <div class="fc-diff-hunks">
          ${diff.hunks.map((hunk, idx) => this._renderHunk(hunk, idx, change.id, language)).join('')}
        </div>
      </div>
    `;
  },

  /**
   * Render a single hunk
   */
  _renderHunk(hunk, index, changeId, language) {
    const hunkId = `${changeId}-hunk-${index}`;
    const isSelected = this._selectedHunks.has(hunkId);
    const isCurrent = index === this._currentHunkIndex;

    return `
      <div class="fc-hunk ${isCurrent ? 'current' : ''}" data-hunk-id="${hunkId}" data-hunk-index="${index}">
        <div class="fc-hunk-header">
          <label class="fc-hunk-checkbox">
            <input type="checkbox" ${isSelected ? 'checked' : ''} data-hunk-id="${hunkId}" />
          </label>
          <span class="fc-hunk-info">@@ -${hunk.oldStart || 0},${hunk.oldLines || 0} +${hunk.newStart || 0},${hunk.newLines || 0} @@</span>
          <div class="fc-hunk-actions">
            <button class="btn btn-xs btn-success fc-hunk-keep" data-hunk-id="${hunkId}">Keep</button>
            <button class="btn btn-xs btn-danger fc-hunk-revert" data-hunk-id="${hunkId}">Revert</button>
          </div>
        </div>
        <div class="fc-hunk-lines">
          ${(hunk.lines || []).map(line => {
            const lineType = line.type || 'context';
            const prefix = lineType === 'added' ? '+' : lineType === 'removed' ? '-' : ' ';
            const highlightedContent = Utils.highlightCode(line.content || '', language);

            return `
              <div class="fc-line ${lineType}">
                <span class="fc-line-num fc-line-old">${line.oldNumber || ''}</span>
                <span class="fc-line-num fc-line-new">${line.newNumber || ''}</span>
                <span class="fc-line-prefix">${prefix}</span>
                <span class="fc-line-content">${highlightedContent}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  /**
   * Set up handlers for session accordions
   */
  _setupSessionHandlers(container) {
    // Session header click - toggle expand
    container.querySelectorAll('.fc-session-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.fc-session-actions')) return;
        const sessionId = header.dataset.sessionId;
        this.toggleSession(sessionId);
      });
    });

    // Session keep all
    container.querySelectorAll('.fc-session-keep').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        // Keep all changes in this session
        const changes = this._getFilteredChanges().filter(c => c.sessionId === sessionId);
        if (changes.length > 0 && confirm(`Keep all ${changes.length} changes in this session?`)) {
          changes.forEach(c => API.keepChange(c.id));
        }
      });
    });

    // Session revert all
    container.querySelectorAll('.fc-session-revert').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        const changes = this._getFilteredChanges().filter(c => c.sessionId === sessionId);
        if (changes.length > 0 && confirm(`Revert all ${changes.length} changes in this session? This cannot be undone.`)) {
          changes.forEach(c => API.revertChange(c.id));
        }
      });
    });

    // File header click - toggle expand
    container.querySelectorAll('.fc-file-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.fc-file-actions')) return;
        const fileKey = header.dataset.fileKey;
        const changeId = header.dataset.changeId;
        this.toggleFile(fileKey, changeId);
      });
    });

    // File keep
    container.querySelectorAll('.fc-file-keep').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        API.keepChange(btn.dataset.changeId);
      });
    });

    // File revert
    container.querySelectorAll('.fc-file-revert').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Revert this change? This cannot be undone.')) {
          API.revertChange(btn.dataset.changeId);
        }
      });
    });

    this._setupDiffHandlers(container);
  },

  /**
   * Set up handlers for diff viewer
   */
  _setupDiffHandlers(container) {
    // Hunk navigation
    container.querySelectorAll('.fc-nav-prev').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._currentHunkIndex > 0) {
          this._currentHunkIndex--;
          this._scrollToCurrentHunk();
        }
      });
    });

    container.querySelectorAll('.fc-nav-next').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._currentHunkIndex < this._totalHunks - 1) {
          this._currentHunkIndex++;
          this._scrollToCurrentHunk();
        }
      });
    });

    // Hunk checkboxes
    container.querySelectorAll('.fc-hunk-checkbox input').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const hunkId = checkbox.dataset.hunkId;
        if (checkbox.checked) {
          this._selectedHunks.add(hunkId);
        } else {
          this._selectedHunks.delete(hunkId);
        }
      });
    });

    // Hunk keep/revert buttons (per-hunk operations)
    container.querySelectorAll('.fc-hunk-keep').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // TODO: Implement per-hunk keep when API is available
        console.log('Keep hunk:', btn.dataset.hunkId);
      });
    });

    container.querySelectorAll('.fc-hunk-revert').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // TODO: Implement per-hunk revert when API is available
        console.log('Revert hunk:', btn.dataset.hunkId);
      });
    });
  },

  /**
   * Scroll to current hunk
   */
  _scrollToCurrentHunk() {
    const currentHunk = document.querySelector(`.fc-hunk[data-hunk-index="${this._currentHunkIndex}"]`);
    if (currentHunk) {
      // Update visual state
      document.querySelectorAll('.fc-hunk').forEach(h => h.classList.remove('current'));
      currentHunk.classList.add('current');

      // Update navigation buttons
      this._updateHunkNavigation();

      // Scroll into view
      currentHunk.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  /**
   * Update hunk navigation UI
   */
  _updateHunkNavigation() {
    const position = document.querySelector('.fc-hunk-position');
    if (position) {
      position.textContent = `Hunk ${this._currentHunkIndex + 1}/${this._totalHunks}`;
    }

    const prevBtn = document.querySelector('.fc-nav-prev');
    const nextBtn = document.querySelector('.fc-nav-next');

    if (prevBtn) {
      prevBtn.disabled = this._currentHunkIndex <= 0;
    }
    if (nextBtn) {
      nextBtn.disabled = this._currentHunkIndex >= this._totalHunks - 1;
    }
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
  toggleFile(fileKey, changeId) {
    if (this._expandedFiles.has(fileKey)) {
      this._expandedFiles.delete(fileKey);
    } else {
      this._expandedFiles.add(fileKey);
      // Request diff for this file
      this.selectedChangeId = changeId;
      API.getDiff(changeId);
    }
    this.renderSessionAccordions();
  },

  /**
   * Handle diff result from API
   */
  handleDiffResult(payload) {
    this.currentDiff = payload;
    this._currentHunkIndex = 0;

    // Re-render the expanded file with the diff
    if (this.selectedChangeId) {
      const fileContent = document.querySelector(`.fc-file-content[data-change-id="${this.selectedChangeId}"]`);
      if (fileContent) {
        const changes = this._getFileChanges();
        const change = changes.find(c => c.id === this.selectedChangeId);
        if (change) {
          fileContent.innerHTML = this._renderFileDiff(change);
          this._setupDiffHandlers(fileContent);
        }
      }
    }
  },

  /**
   * Show diff (called from state subscription)
   */
  showDiff(diff) {
    this.currentDiff = diff;
    // This is handled by renderSessionAccordions
  }
};

// Register with Router if available
if (typeof Router !== 'undefined' && Router.register) {
  Router.register('file-changes', FileChangesView);
}

// Export to window for global access
window.FileChangesView = FileChangesView;
