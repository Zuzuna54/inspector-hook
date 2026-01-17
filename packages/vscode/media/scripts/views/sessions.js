/**
 * Sessions View
 * Shows session list with tool execution timeline and file changes
 */

const SessionsView = {
  // Subscription cleanup functions
  _unsubscribers: [],

  // Expanded tool items
  _expandedTools: new Set(),

  /**
   * Initialize the sessions view
   */
  init() {
    this.render();

    // Subscribe to state changes
    this._unsubscribers.push(
      State.subscribe('sessions', () => this.renderList())
    );
    this._unsubscribers.push(
      State.subscribe('selectedSession', () => this.renderList())
    );

    // Request fresh sessions
    API.getSessions();
  },

  /**
   * Clean up subscriptions
   */
  cleanup() {
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
  },

  /**
   * Render the complete sessions view
   */
  render() {
    this.renderList();
  },

  /**
   * Render the sessions list
   */
  renderList() {
    const container = document.getElementById('sessions-list');
    if (!container) return;

    const { sessions, selectedSession } = State;

    if (sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No sessions yet</div>
          <div class="empty-state-description">Sessions will appear here when Claude Code is active</div>
        </div>
      `;
      return;
    }

    // Sort sessions by start time (newest first)
    const sortedSessions = [...sessions].sort((a, b) => {
      const timeA = new Date(a.startTime || 0).getTime();
      const timeB = new Date(b.startTime || 0).getTime();
      return timeB - timeA;
    });

    // Get selected session object
    const selectedSessionObj = selectedSession
      ? sortedSessions.find(s => s.id === selectedSession)
      : null;

    container.innerHTML = `
      ${sortedSessions.map(session => `
        <div class="session-card ${session.status || 'unknown'} ${session.id === selectedSession ? 'selected' : ''}"
             data-session-id="${session.id}">
          <div class="session-header">
            <div class="session-header-left">
              <span class="session-status-dot ${session.status || 'unknown'}"></span>
              <span class="session-name">${Utils.escapeHtml(session.name || session.id)}</span>
              <span class="session-status-text">${session.status || 'unknown'}</span>
            </div>
            <div class="session-header-right">
              <button class="btn btn-xs btn-danger session-delete-btn" data-session-id="${session.id}" title="Delete session">
                &times;
              </button>
            </div>
          </div>
          <div class="session-meta">
            <span class="session-time">${Utils.formatDate(session.startTime)}</span>
            <span class="session-duration">${Utils.formatDuration(session.startTime, session.endTime)}</span>
          </div>
          <div class="session-stats">
            <span class="stat">
              <strong>${(session.toolExecutions && session.toolExecutions.length) || 0}</strong> tools
            </span>
            <span class="stat">
              <strong>${(session.fileChanges && session.fileChanges.length) || 0}</strong> files
            </span>
          </div>
          ${session.id === selectedSession ? this.renderSessionDetail(session) : ''}
        </div>
      `).join('')}
    `;

    // Add click handlers for session cards
    container.querySelectorAll('.session-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Ignore clicks on buttons
        if (e.target.closest('button')) return;

        const sessionId = card.dataset.sessionId;
        this.selectSession(sessionId);
      });
    });

    // Add click handlers for delete buttons
    container.querySelectorAll('.session-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        this.confirmDeleteSession(sessionId);
      });
    });

    // Add click handlers for file changes links
    container.querySelectorAll('.view-session-files').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        // Set session filter and navigate to file-changes
        State.update('filters', { ...State.filters, session: sessionId });
        Router.navigate('file-changes');
      });
    });

    // Add click handlers for close buttons
    container.querySelectorAll('.close-session-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        State.update('selectedSession', null);
      });
    });

    // Set up tool item handlers
    this._setupToolHandlers(container);
  },

  /**
   * Set up handlers for tool items
   * @param {HTMLElement} container
   */
  _setupToolHandlers(container) {
    container.querySelectorAll('.tool-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const toolId = item.dataset.toolId;
        this.toggleToolExpand(toolId, item);
      });
    });
  },

  /**
   * Toggle tool item expansion
   * @param {string} toolId
   * @param {HTMLElement} itemElement
   */
  toggleToolExpand(toolId, itemElement) {
    const details = itemElement.querySelector('.tool-details');
    const expand = itemElement.querySelector('.tool-expand');

    if (this._expandedTools.has(toolId)) {
      this._expandedTools.delete(toolId);
      details?.classList.add('hidden');
      if (expand) expand.textContent = '+';
      itemElement.classList.remove('expanded');
    } else {
      this._expandedTools.add(toolId);
      details?.classList.remove('hidden');
      if (expand) expand.textContent = '-';
      itemElement.classList.add('expanded');
    }
  },

  /**
   * Show delete confirmation modal
   * @param {string} sessionId
   */
  confirmDeleteSession(sessionId) {
    // Find session name for display
    const session = this.getSession(sessionId);
    const sessionName = session?.name || sessionId.slice(0, 8);

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-title">Delete Session</span>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete session <strong>${Utils.escapeHtml(sessionName)}</strong>?</p>
          <p class="modal-warning">This will also delete all associated logs and file changes. This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary modal-cancel">Cancel</button>
          <button class="btn btn-danger modal-confirm">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Animate in
    requestAnimationFrame(() => {
      modal.classList.add('visible');
    });

    // Handle cancel
    modal.querySelector('.modal-cancel')?.addEventListener('click', () => {
      modal.classList.remove('visible');
      setTimeout(() => modal.remove(), 200);
    });

    // Handle confirm
    modal.querySelector('.modal-confirm')?.addEventListener('click', () => {
      API.deleteSession(sessionId);
      modal.classList.remove('visible');
      setTimeout(() => modal.remove(), 200);
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 200);
      }
    });
  },

  /**
   * Render tool badges for a session
   * @param {Array} tools - Array of tool objects
   * @returns {string} HTML string
   */
  renderToolBadges(tools) {
    if (!tools || tools.length === 0) return '';

    const visibleTools = tools.slice(0, 5);
    const remainingCount = tools.length - 5;

    return `
      <div class="session-tools">
        ${visibleTools.map(tool => `
          <span class="tool-badge ${tool.status || ''}">${Utils.escapeHtml(tool.name || 'unknown')}</span>
        `).join('')}
        ${remainingCount > 0 ? `<span class="tool-more">+${remainingCount} more</span>` : ''}
      </div>
    `;
  },

  /**
   * Render expandable tool execution list
   * @param {Array} tools - Array of tool objects
   * @param {string} sessionId - Session ID for unique tool IDs
   * @returns {string} HTML string
   */
  renderToolList(tools, sessionId) {
    if (!tools || tools.length === 0) {
      return '<div class="tool-executions empty">No tool executions</div>';
    }

    return `
      <div class="tool-executions">
        <div class="tool-list-header">Tool Executions (${tools.length})</div>
        ${tools.map((tool, idx) => {
          const toolId = `${sessionId}-tool-${idx}`;
          const isExpanded = this._expandedTools.has(toolId);
          const statusIcon = tool.status === 'completed' || tool.status === 'success' ? '&#10003;' :
                            tool.status === 'error' || tool.status === 'failed' ? '&#10007;' :
                            tool.status === 'running' ? '&#8226;' : '&#8226;';
          const statusClass = tool.status || 'completed';

          // Calculate duration from startTime/endTime
          let duration = null;
          if (tool.startTime && tool.endTime) {
            duration = new Date(tool.endTime) - new Date(tool.startTime);
          }

          return `
            <div class="tool-item ${isExpanded ? 'expanded' : ''}" data-tool-id="${toolId}">
              <div class="tool-header">
                <span class="tool-name">${Utils.escapeHtml(tool.tool || 'Unknown')}</span>
                <span class="tool-status ${statusClass}">${statusIcon}</span>
                ${duration !== null ? `<span class="tool-duration">${duration}ms</span>` : ''}
                <span class="tool-expand">${isExpanded ? '-' : '+'}</span>
              </div>
              <div class="tool-details ${isExpanded ? '' : 'hidden'}">
                ${tool.input ? `
                  <div class="tool-input">
                    <label>Input:</label>
                    ${Utils.createCodeBlock(
                      typeof tool.input === 'object' ? JSON.stringify(tool.input, null, 2) : tool.input,
                      'json',
                      { showHeader: false, maxHeight: 150 }
                    )}
                  </div>
                ` : ''}
                ${tool.result ? `
                  <div class="tool-output">
                    <label>Output:</label>
                    ${Utils.createCodeBlock(
                      typeof tool.result === 'object' ? JSON.stringify(tool.result, null, 2) : String(tool.result).slice(0, 2000),
                      Utils.detectLanguage(tool.affectedFiles?.[0] || '', typeof tool.result === 'string' ? tool.result : ''),
                      { showHeader: false, maxHeight: 150 }
                    )}
                  </div>
                ` : ''}
                ${tool.error ? `
                  <div class="tool-error">
                    <label>Error:</label>
                    <pre class="error-content">${Utils.escapeHtml(tool.error)}</pre>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  /**
   * Render expanded session detail panel
   * @param {Object} session - Session object
   * @returns {string} HTML string
   */
  renderSessionDetail(session) {
    if (!session) return '';

    const fileChangesCount = session.fileChanges?.length || 0;

    return `
      <div class="session-detail-panel">
        <div class="detail-header">
          <h4>Session Details</h4>
          <button class="btn btn-xs btn-close close-session-detail" aria-label="Close">&times;</button>
        </div>
        <div class="detail-body">
          <div class="detail-row">
            <span class="label">ID:</span>
            <span class="value">${Utils.escapeHtml(session.id)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Started:</span>
            <span class="value">${Utils.formatDate(session.startTime)}</span>
          </div>
          ${session.endTime ? `
            <div class="detail-row">
              <span class="label">Ended:</span>
              <span class="value">${Utils.formatDate(session.endTime)}</span>
            </div>
          ` : ''}
          <div class="detail-row">
            <span class="label">Duration:</span>
            <span class="value">${Utils.formatDuration(session.startTime, session.endTime)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Tools Used:</span>
            <span class="value">${(session.toolExecutions && session.toolExecutions.length) || 0}</span>
          </div>
          <div class="detail-row">
            <span class="label">Files Changed:</span>
            <span class="value">
              ${fileChangesCount}
              ${fileChangesCount > 0 ? `
                <button class="btn btn-xs btn-link view-session-files" data-session-id="${session.id}">
                  View changes
                </button>
              ` : ''}
            </span>
          </div>
        </div>
        ${this.renderToolList(session.toolExecutions, session.id)}
      </div>
    `;
  },

  /**
   * Select a session
   * @param {string} sessionId - Session ID
   */
  selectSession(sessionId) {
    const currentSelected = State.selectedSession;

    if (currentSelected === sessionId) {
      // Deselect if clicking the same session
      State.update('selectedSession', null);
    } else {
      State.update('selectedSession', sessionId);
      // Could request more session details here
      API.getSession(sessionId);
    }
  },

  /**
   * Get session by ID from state
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session object or null
   */
  getSession(sessionId) {
    return State.sessions.find(s => s.id === sessionId) || null;
  }
};

// Register view with router
Router.register('sessions', SessionsView);

// Make globally available
window.SessionsView = SessionsView;
