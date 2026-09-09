/**
 * Rendering for the Archived view.
 *
 * Split out when the view crossed the 600-line limit. Pure output: it turns
 * grouped changes into HTML and touches no state and no API — which is why it
 * can be extracted at all, and why the handlers stayed behind.
 *
 * It still calls `this._setupSessionHandlers`, which lives on the view. That
 * works because the mixin is composed onto the view with Object.assign, so
 * both halves share one `this` and no call site changes.
 */

const ArchivedRenderMixin = {
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
};

window.ArchivedRenderMixin = ArchivedRenderMixin;
