/**
 * Logs View
 * Shows filterable log table with detail panel and virtual scrolling
 */

const LogsView = {
  // Subscription cleanup functions
  _unsubscribers: [],

  // Virtual scrolling state
  _visibleRowCount: 100,
  /** How many rows we have asked the core for. Grows with Load More. */
  _fetchLimit: 1000,
  _currentOffset: 0,

  // Currently open popup row
  _openPopupIndex: null,
  _clickOutsideHandler: null,

  /**
   * Initialize the logs view
   */
  init() {
    this.render();

    // Subscribe to state changes
    this._unsubscribers.push(
      State.subscribe('logs', () => this.renderTable())
    );
    this._unsubscribers.push(
      State.subscribe('filters', () => this.renderTable())
    );
    this._unsubscribers.push(
      State.subscribe('searchQuery', () => this.renderTable())
    );
    this._unsubscribers.push(
      State.subscribe('sessions', () => this.updateSessionFilter())
    );

    // Request fresh logs
    API.getLogs();
  },

  /**
   * Clean up subscriptions
   */
  cleanup() {
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
    this._currentOffset = 0;
    this._closeAllPopups();
  },

  /**
   * Close all open popups and cleanup handlers
   */
  _closeAllPopups() {
    this._openPopupIndex = null;
    if (this._clickOutsideHandler) {
      document.removeEventListener('click', this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }
    // Remove all popup rows
    document.querySelectorAll('.log-detail-popup').forEach(el => {
      el.remove();
    });
  },

  /**
   * Render the complete logs view
   */
  render() {
    const container = document.getElementById('logs-table');
    if (!container) return;

    // Render filter bar and table container (no side panel - using inline popups)
    container.innerHTML = `
      <div class="logs-filter-bar">
        <div class="filter-group">
          <label class="filter-label">Level</label>
          <select id="filter-level" class="select filter-select">
            <option value="">All Levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label">Hook</label>
          <select id="filter-hook" class="select filter-select">
            <option value="">All Hooks</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label">Session</label>
          <select id="filter-session" class="select filter-select">
            <option value="">All Sessions</option>
          </select>
        </div>
        <div class="filter-spacer"></div>
        <div class="filter-count">
          <span id="log-count">0</span> logs
        </div>
      </div>
      <div class="logs-table-wrapper">
        <div class="logs-table-container" id="logs-table-body"></div>
      </div>
    `;

    // Set up filter handlers
    this.setupFilters();

    // Render table
    this.renderTable();
  },

  /**
   * Set up filter event handlers
   */
  setupFilters() {
    const filterLevel = document.getElementById('filter-level');
    if (filterLevel) {
      filterLevel.value = State.filters.level || '';
      filterLevel.addEventListener('change', (e) => {
        State.update('filters', {
          ...State.filters,
          level: e.target.value || null
        });
      });
    }

    const filterHook = document.getElementById('filter-hook');
    if (filterHook) {
      // Populate hook options from logs
      this.populateHookFilter(filterHook);

      filterHook.value = State.filters.hook || '';
      filterHook.addEventListener('change', (e) => {
        State.update('filters', {
          ...State.filters,
          hook: e.target.value || null
        });
      });
    }

    // Set up session filter
    this.setupSessionFilter();
  },

  /**
   * Set up session filter dropdown
   */
  setupSessionFilter() {
    const filterSession = document.getElementById('filter-session');
    if (!filterSession) return;

    // Populate from sessions state
    this.populateSessionFilter(filterSession);

    filterSession.value = State.filters.session || '';
    filterSession.addEventListener('change', (e) => {
      State.update('filters', {
        ...State.filters,
        session: e.target.value || null
      });
    });
  },

  /**
   * Populate session filter dropdown with available sessions
   * @param {HTMLSelectElement} select - Select element
   */
  populateSessionFilter(select) {
    const sessions = State.sessions || [];
    const currentValue = select.value;

    select.innerHTML = '<option value="">All Sessions</option>';
    sessions.forEach(session => {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = session.name || session.id.slice(0, 8);
      select.appendChild(option);
    });

    select.value = currentValue;
  },

  /**
   * Update session filter when sessions change
   */
  updateSessionFilter() {
    const filterSession = document.getElementById('filter-session');
    if (filterSession) {
      this.populateSessionFilter(filterSession);
    }
  },

  /**
   * Populate hook filter dropdown with unique hooks
   * @param {HTMLSelectElement} select - Select element
   */
  populateHookFilter(select) {
    const hooks = new Set();
    State.logs.forEach(log => {
      if (log.hook) hooks.add(log.hook);
    });

    const currentValue = select.value;
    select.innerHTML = '<option value="">All Hooks</option>';

    Array.from(hooks).sort().forEach(hook => {
      const option = document.createElement('option');
      option.value = hook;
      option.textContent = hook;
      select.appendChild(option);
    });

    select.value = currentValue;
  },

  /**
   * Render the logs table
   */
  renderTable() {
    const container = document.getElementById('logs-table-body');
    if (!container) return;

    const { logs, searchQuery, filters } = State;

    // Filter logs
    let filteredLogs = logs;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredLogs = filteredLogs.filter(log =>
        (log.message || '').toLowerCase().includes(query) ||
        (log.hook || '').toLowerCase().includes(query) ||
        (log.event || '').toLowerCase().includes(query)
      );
    }

    if (filters.level) {
      filteredLogs = filteredLogs.filter(log => log.level === filters.level);
    }

    if (filters.hook) {
      filteredLogs = filteredLogs.filter(log => log.hook === filters.hook);
    }

    // Session filter
    if (filters.session) {
      filteredLogs = filteredLogs.filter(log => log.sessionId === filters.session);
    }

    // Update count.
    //
    // Says "N of M" whenever the core holds more than the panel fetched, so a
    // number smaller than the Dashboard's is explained rather than simply
    // wrong. An unqualified "100" next to a Dashboard reading thousands is a
    // false statement about the same quantity.
    const logCount = document.getElementById('log-count');
    if (logCount) {
      const total = State.logsTotal || 0;
      const held = logs.length;
      logCount.textContent =
        total > held
          ? `${filteredLogs.length} of ${total}`
          : String(filteredLogs.length);
    }

    // Render empty state
    if (filteredLogs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No logs found</div>
          <div class="empty-state-description">
            ${logs.length === 0
              ? 'Logs will appear here as hooks are triggered'
              : 'Try adjusting your filters'}
          </div>
        </div>
      `;
      return;
    }

    // Head truncation with progressive reveal. NOT virtual scrolling -- the
    // comment here used to say it was, and that is why nobody looked: every
    // Load More rebuilds the whole table's innerHTML and attaches a listener
    // per row, so the DOM grows monotonically, which is the opposite of
    // windowing. Real windowing exists in views/history/virtual-scroll.js and
    // this view has never loaded it.
    const VISIBLE_ROWS = this._visibleRowCount;
    const visibleLogs = filteredLogs.slice(0, VISIBLE_ROWS);

    // More to show if we are holding more than we render, OR if the core holds
    // more than we have fetched. The second case was unreachable while the
    // fetch limit and this cap were both hardcoded to 100.
    const heldRemaining = Math.max(filteredLogs.length - VISIBLE_ROWS, 0);
    const unfetched = Math.max((State.logsTotal || 0) - logs.length, 0);
    const hasMore = heldRemaining > 0 || unfetched > 0;
    const remainingCount = heldRemaining + unfetched;

    // Store filtered logs for click handlers
    this._filteredLogs = filteredLogs;

    // Render table
    container.innerHTML = `
      <table class="logs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Hook</th>
            <th>Event</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${visibleLogs.map((log, index) => `
            <tr class="log-row ${log.level || 'info'}" data-log-index="${index}">
              <td class="log-time">${Utils.formatTime(log.timestamp)}</td>
              <td>
                <span class="log-level-badge ${log.level || 'info'}">
                  ${log.level || 'info'}
                </span>
              </td>
              <td class="log-hook">${Utils.escapeHtml(log.hook || '')}</td>
              <td class="log-event">${Utils.escapeHtml(log.event || '')}</td>
              <td class="log-message">${Utils.escapeHtml(log.message || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${hasMore ? `
        <div class="load-more">
          <button class="btn btn-secondary" id="load-more-logs">
            Load More (${remainingCount} remaining)
          </button>
        </div>
      ` : ''}
    `;

    // Add click handlers for rows
    container.querySelectorAll('.log-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const index = parseInt(row.dataset.logIndex, 10);
        if (!isNaN(index) && this._filteredLogs[index]) {
          // If clicking on the same row that's expanded, collapse it
          if (this._openPopupIndex === index) {
            this._closeAllPopups();
          } else {
            // Clear any previous expansion state
            document.querySelectorAll('.log-row-expanded').forEach(r => {
              r.classList.remove('log-row-expanded');
            });
            this.showLogDetail(this._filteredLogs[index], index, row);
          }
        }
      });
      row.style.cursor = 'pointer';
    });

    // Add load more handler
    const loadMoreBtn = document.getElementById('load-more-logs');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this._visibleRowCount += 100;
        // Ask the core for more once we are about to run past what we hold.
        // Revealing rows we never fetched is what made the cap look like a
        // rendering limit when it was really a fetch limit.
        const held = (State.logs || []).length;
        if (this._visibleRowCount >= held && (State.logsTotal || 0) > held) {
          this._fetchLimit = Math.max(this._fetchLimit + 1000, this._visibleRowCount + 1000);
          API.getLogs({ ...State.filters }, { limit: this._fetchLimit });
        }
        this.renderTable();
      });
    }

    // Update hook filter if we have new hooks
    const filterHook = document.getElementById('filter-hook');
    if (filterHook) {
      this.populateHookFilter(filterHook);
    }
  },

  /**
   * Show log detail popup below the clicked row
   * @param {Object} log - Log object to display
   * @param {number} rowIndex - Index of the clicked row
   * @param {HTMLElement} rowElement - The row element that was clicked
   */
  showLogDetail(log, rowIndex, rowElement) {
    // Close any existing popup
    this._closeAllPopups();

    // Mark this row as having the open popup
    this._openPopupIndex = rowIndex;
    rowElement.classList.add('log-row-expanded');

    // Create the popup row
    const popupRow = document.createElement('tr');
    popupRow.className = 'log-detail-popup';
    popupRow.innerHTML = `
      <td colspan="5">
        <div class="popup-content">
          <div class="popup-header">
            <span class="popup-title">Log Details</span>
            <button class="btn btn-xs btn-close popup-close" aria-label="Close">&times;</button>
          </div>
          <div class="popup-body">
            <div class="popup-field">
              <span class="popup-label">ID:</span>
              <span class="popup-value">${Utils.escapeHtml(log.id || 'N/A')}</span>
            </div>
            <div class="popup-field">
              <span class="popup-label">Timestamp:</span>
              <span class="popup-value">${Utils.formatDate(log.timestamp)}</span>
            </div>
            <div class="popup-field">
              <span class="popup-label">Level:</span>
              <span class="popup-value"><span class="log-level-badge ${log.level || 'info'}">${log.level || 'info'}</span></span>
            </div>
            <div class="popup-field">
              <span class="popup-label">Hook:</span>
              <span class="popup-value">${Utils.escapeHtml(log.hook || 'N/A')}</span>
            </div>
            <div class="popup-field">
              <span class="popup-label">Event:</span>
              <span class="popup-value">${Utils.escapeHtml(log.event || 'N/A')}</span>
            </div>
            <div class="popup-field">
              <span class="popup-label">Session:</span>
              <span class="popup-value">${Utils.escapeHtml(log.sessionId || 'N/A')}</span>
            </div>
            <div class="popup-field">
              <span class="popup-label">Message:</span>
              <span class="popup-value">${Utils.escapeHtml(log.message || 'N/A')}</span>
            </div>
            ${log.tool ? `
              <div class="popup-field">
                <span class="popup-label">Tool:</span>
                <span class="popup-value">${Utils.escapeHtml(log.tool)}</span>
              </div>
            ` : ''}
            ${log.file ? `
              <div class="popup-field">
                <span class="popup-label">File:</span>
                <span class="popup-value">${Utils.escapeHtml(log.file)}</span>
              </div>
            ` : ''}
            ${this._renderToolInputOutput(log)}
            ${log.context ? `
              <div class="popup-field popup-field-full">
                <span class="popup-label">Context:</span>
                <div class="popup-code-block">
                  ${Utils.createCodeBlock(
                    typeof log.context === 'object' ? JSON.stringify(log.context, null, 2) : log.context,
                    'json',
                    { showHeader: false, maxHeight: 200 }
                  )}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </td>
    `;

    // Insert popup after the clicked row
    rowElement.insertAdjacentElement('afterend', popupRow);

    // Animate in
    requestAnimationFrame(() => {
      popupRow.classList.add('popup-visible');
    });

    // Set up close button handler
    popupRow.querySelector('.popup-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeAllPopups();
    });

    // Set up click-outside handler
    this._clickOutsideHandler = (e) => {
      const popup = document.querySelector('.log-detail-popup');
      const clickedRow = e.target.closest('.log-row');

      // Close if clicking outside the popup and not on another row
      if (popup && !popup.contains(e.target) && !clickedRow) {
        this._closeAllPopups();
      }
    };

    // Delay adding the click handler to prevent immediate close
    setTimeout(() => {
      document.addEventListener('click', this._clickOutsideHandler);
    }, 100);
  },

  /**
   * Render tool input/output if present in the log
   * @param {Object} log - Log object
   * @returns {string} HTML string
   */
  _renderToolInputOutput(log) {
    let html = '';

    // Check for tool input in details (from hooks) or directly on log
    const toolInput = log.details?.tool_input || log.toolInput;
    if (toolInput) {
      const inputStr = typeof toolInput === 'object'
        ? JSON.stringify(toolInput, null, 2)
        : String(toolInput);
      html += `
        <div class="popup-field popup-field-full">
          <span class="popup-label">Tool Input:</span>
          <div class="popup-code-block">
            ${Utils.createCodeBlock(inputStr, 'json', { showHeader: false, maxHeight: 200 })}
          </div>
        </div>
      `;
    }

    // Check for tool result/output in details (from hooks) or directly on log
    const toolOutput = log.details?.tool_result || log.toolOutput;
    if (toolOutput) {
      const outputStr = typeof toolOutput === 'object'
        ? JSON.stringify(toolOutput, null, 2)
        : String(toolOutput);
      html += `
        <div class="popup-field popup-field-full">
          <span class="popup-label">Tool Output:</span>
          <div class="popup-code-block">
            ${Utils.createCodeBlock(outputStr, 'json', { showHeader: false, maxHeight: 200 })}
          </div>
        </div>
      `;
    }

    return html;
  }
};

// Register view with router
Router.register('logs', LogsView);

// Make globally available
window.LogsView = LogsView;
