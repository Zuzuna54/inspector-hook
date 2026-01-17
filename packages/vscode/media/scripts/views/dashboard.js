/**
 * Dashboard View
 * Shows stats cards and recent activity
 */

const DashboardView = {
  // Subscription cleanup functions
  _unsubscribers: [],

  /**
   * Initialize the dashboard view
   */
  init() {
    this.render();

    // Subscribe to state changes
    this._unsubscribers.push(
      State.subscribe('stats', () => this.renderStats())
    );
    this._unsubscribers.push(
      State.subscribe('logs', () => this.renderRecentActivity())
    );
    this._unsubscribers.push(
      State.subscribe('sessions', () => this.renderStats())
    );
    this._unsubscribers.push(
      State.subscribe('fileChanges', () => this.renderStats())
    );
  },

  /**
   * Clean up subscriptions
   */
  cleanup() {
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
  },

  /**
   * Render the complete dashboard
   */
  render() {
    this.renderStats();
    this.renderRecentActivity();
  },

  /**
   * Render stats cards
   */
  renderStats() {
    console.log('[DashboardView] renderStats called');
    const { stats, sessions, fileChanges } = State;
    console.log('[DashboardView] stats:', stats);
    console.log('[DashboardView] sessions:', sessions?.length);
    console.log('[DashboardView] fileChanges:', fileChanges?.length);

    // Basic stats
    const totalLogs = document.getElementById('total-logs');
    if (totalLogs) totalLogs.textContent = this.formatNumber(stats.totalLogs);

    const totalErrors = document.getElementById('total-errors');
    if (totalErrors) totalErrors.textContent = this.formatNumber(stats.errors);

    const totalWarnings = document.getElementById('total-warnings');
    if (totalWarnings) totalWarnings.textContent = this.formatNumber(stats.warnings);

    const totalBlocked = document.getElementById('total-blocked');
    if (totalBlocked) totalBlocked.textContent = this.formatNumber(stats.blocked);

    // Extended stats
    const activeSessions = document.getElementById('active-sessions');
    if (activeSessions) {
      const active = sessions.filter(s => s.status === 'active').length;
      activeSessions.textContent = active;
    }

    const pendingChanges = document.getElementById('pending-changes');
    if (pendingChanges) {
      pendingChanges.textContent = fileChanges.length;
    }

    // Update header stats as well
    const statErrors = document.getElementById('stat-errors');
    if (statErrors) statErrors.textContent = `${stats.errors} errors`;

    const statChanges = document.getElementById('stat-changes');
    if (statChanges) statChanges.textContent = `${fileChanges.length} changes`;
  },

  /**
   * Render recent activity log list
   */
  renderRecentActivity() {
    console.log('[DashboardView] renderRecentActivity called');
    console.log('[DashboardView] State.logs:', State.logs?.length);
    const container = document.getElementById('recent-logs');
    if (!container) {
      console.log('[DashboardView] ERROR: recent-logs container not found!');
      return;
    }

    const recentLogs = State.logs.slice(0, 10);
    console.log('[DashboardView] recentLogs to render:', recentLogs?.length);

    if (recentLogs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No recent activity</div>
          <div class="empty-state-description">Activity will appear here as hooks are triggered</div>
        </div>
      `;
      return;
    }

    container.innerHTML = recentLogs.map(log => `
      <div class="log-item ${log.level || 'info'}">
        <span class="log-time">${Utils.formatTime(log.timestamp)}</span>
        <span class="log-level ${log.level || 'info'}">${log.level || 'info'}</span>
        <span class="log-hook">${Utils.escapeHtml(log.hook || '')}</span>
        <span class="log-message">${Utils.escapeHtml(log.message || log.event || '')}</span>
      </div>
    `).join('');
  },

  /**
   * Format large numbers with commas
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  formatNumber(num) {
    if (num === undefined || num === null) return '0';
    return num.toLocaleString();
  }
};

// Register view with router
Router.register('dashboard', DashboardView);

// Make globally available
window.DashboardView = DashboardView;
