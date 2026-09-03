/**
 * Webview HTML.
 *
 * Extracted from panel.ts, which had grown to 850 lines with ~350 of them a
 * single template literal.
 *
 * It also removes a real duplication hazard: an identical copy of this markup
 * lived at `media/index.html`, referenced by nothing — panel.ts always built
 * the page inline. Two copies of the UI shell, one of them dead, is a trap for
 * anyone who edits the obvious-looking file and sees no effect. The dead copy
 * is deleted; this is the only one.
 */

import * as vscode from "vscode";
/**
 * Generate a random nonce
 */
function getNonce(): string {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * A per-render nonce. The Content-Security-Policy allows only scripts carrying
 * it, so an injected inline script cannot execute.
 */

/**
 * Build the panel's HTML.
 *
 * Asset URIs must be resolved through `webview.asWebviewUri`, and every script
 * carries the CSP nonce — the webview refuses to execute a script without it.
 */
export function buildWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
): string {
	// Helper to get webview URI
	const getUri = (...paths: string[]) =>
		webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, "media", ...paths),
		);

	// CSS URIs
	const variablesCss = getUri("styles", "variables.css");
	const layoutCss = getUri("styles", "layout.css");
	const componentsCss = getUri("styles", "components.css");
	const prismThemeCss = getUri("styles", "prism-theme.css");
	const dashboardCss = getUri("styles", "views", "dashboard.css");
	const logsCss = getUri("styles", "views", "logs.css");
	const sessionsCss = getUri("styles", "views", "sessions.css");
	// Note: file-changes.css, history.css, archived.css created by Agent 2
	const fileChangesCss = getUri("styles", "views", "file-changes.css");
	const historyCss = getUri("styles", "views", "history.css");
	const archivedCss = getUri("styles", "views", "archived.css");

	// JS URIs (order matters - dependencies first)
	const stateJs = getUri("scripts", "state.js");
	const routerJs = getUri("scripts", "router.js");
	const apiJs = getUri("scripts", "api.js");
	const dashboardJs = getUri("scripts", "views", "dashboard.js");
	const logsJs = getUri("scripts", "views", "logs.js");
	const sessionsJs = getUri("scripts", "views", "sessions.js");
	// sessions.js is being split into modules under scripts/views/sessions/.
	// These load before it and are individually optional: a missing file is a
	// 404 the webview ignores, so the tags can land before the files do.
	const sessionUtilsJs = getUri("scripts", "session-utils.js");
	const sessionListJs = getUri("scripts", "views", "sessions", "session-list.js");
	const activityFeedJs = getUri("scripts", "views", "sessions", "activity-feed.js");
	const activityItemsJs = getUri("scripts", "views", "sessions", "activity-items.js");
	const toolDetailJs = getUri("scripts", "views", "sessions", "tool-detail.js");
	const sessionDetailJs = getUri("scripts", "views", "sessions", "session-detail.js");
	// Note: file-changes.js, history.js, archived.js created by Agent 2
	const fileChangesJs = getUri("scripts", "views", "file-changes.js");
	// file-changes.js is being split into modules under scripts/views/file-changes/.
	// Loaded before it, and individually optional -- a file that does not exist
	// yet is a 404 the webview ignores, so the tags can land before the files.
	const fcSessionListJs = getUri("scripts", "views", "file-changes", "fc-session-list.js");
	const fcDiffViewJs = getUri("scripts", "views", "file-changes", "fc-diff-view.js");
	const fcEditorJs = getUri("scripts", "views", "file-changes", "fc-editor.js");
	const fcActionsJs = getUri("scripts", "views", "file-changes", "fc-actions.js");
	const historyJs = getUri("scripts", "views", "history.js");
	const archivedJs = getUri("scripts", "views", "archived.js");
	const mainJs = getUri("scripts", "main.js");

	// Use a nonce to only allow specific scripts to run
	const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">

  <!-- CSS Files -->
  <link href="${variablesCss}" rel="stylesheet">
  <link href="${layoutCss}" rel="stylesheet">
  <link href="${componentsCss}" rel="stylesheet">
  <link href="${prismThemeCss}" rel="stylesheet">
  <link href="${dashboardCss}" rel="stylesheet">
  <link href="${logsCss}" rel="stylesheet">
  <link href="${sessionsCss}" rel="stylesheet">
  <link href="${fileChangesCss}" rel="stylesheet">
  <link href="${historyCss}" rel="stylesheet">
  <link href="${archivedCss}" rel="stylesheet">

  <title>Inspector Hook</title>
</head>
<body>
  <div id="app">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <span class="status-indicator connected" id="status-indicator"></span>
        <span class="status-text" id="status-text">Connected</span>
        <div class="header-stats">
          <span class="header-stat error" id="stat-errors">0 errors</span>
          <span class="header-stat changes" id="stat-changes">0 changes</span>
        </div>
      </div>
      <div class="header-right">
        <input type="text" id="search" placeholder="Search logs..." class="input search-input" aria-label="Search logs">
        <button id="clear-btn" class="btn btn-secondary">Clear</button>
      </div>
    </header>

    <!-- Tab Navigation -->
    <nav class="tabs" role="tablist" aria-label="View navigation">
      <button class="tab active" data-view="dashboard" role="tab" aria-selected="true" tabindex="0">
        Dashboard
      </button>
      <button class="tab" data-view="logs" role="tab" aria-selected="false" tabindex="-1">
        Logs
        <span class="tab-badge" id="tab-logs-count">0</span>
      </button>
      <button class="tab" data-view="sessions" role="tab" aria-selected="false" tabindex="-1">
        Sessions
      </button>
      <button class="tab" data-view="file-changes" role="tab" aria-selected="false" tabindex="-1">
        File Changes
        <span class="tab-badge" id="tab-changes-count">0</span>
      </button>
      <button class="tab" data-view="history" role="tab" aria-selected="false" tabindex="-1">
        History
      </button>
      <button class="tab" data-view="archived" role="tab" aria-selected="false" tabindex="-1">
        Archived
      </button>
    </nav>

    <!-- Main Content -->
    <main class="main">
      <!-- Dashboard View -->
      <div id="view-dashboard" class="view active" role="tabpanel" aria-labelledby="tab-dashboard">
        <div class="dashboard-grid">
          <div class="stat-card">
            <div class="stat-value" id="total-logs">0</div>
            <div class="stat-label">Total Logs</div>
          </div>
          <div class="stat-card error">
            <div class="stat-value" id="total-errors">0</div>
            <div class="stat-label">Errors</div>
          </div>
          <div class="stat-card warning">
            <div class="stat-value" id="total-warnings">0</div>
            <div class="stat-label">Warnings</div>
          </div>
          <div class="stat-card blocked">
            <div class="stat-value" id="total-blocked">0</div>
            <div class="stat-label">Blocked</div>
          </div>
          <div class="stat-card success">
            <div class="stat-value" id="active-sessions">0</div>
            <div class="stat-label">Active Sessions</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="pending-changes">0</div>
            <div class="stat-label">Pending Changes</div>
          </div>
        </div>
        <div class="recent-activity">
          <div class="recent-activity-header">
            <span class="recent-activity-title">Recent Activity</span>
          </div>
          <div class="recent-activity-content">
            <div id="recent-logs" class="log-list">
              <div class="empty-state">
                <div class="empty-state-title">No recent activity</div>
                <div class="empty-state-description">Activity will appear here as hooks are triggered</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Logs View -->
      <div id="view-logs" class="view hidden" role="tabpanel" aria-labelledby="tab-logs">
        <div id="logs-table" class="logs-table-container">
          <div class="empty-state">
            <div class="empty-state-title">Loading logs...</div>
          </div>
        </div>
      </div>

      <!-- Sessions View -->
      <div id="view-sessions" class="view hidden" role="tabpanel" aria-labelledby="tab-sessions">
        <div class="sv-container">
          <!-- Sessions Sidebar -->
          <div class="sv-sidebar">
            <div class="sv-header">
              <h3>Sessions</h3>
              <span class="sv-count" id="sv-session-count">0 sessions</span>
            </div>
            <div class="sv-search">
              <input type="text" id="sv-search" placeholder="Search sessions..." class="input" />
            </div>
            <div class="sv-list" id="sv-session-list">
              <div class="empty-state">
                <div class="empty-state-title">No sessions yet</div>
                <div class="empty-state-description">Sessions will appear here when Claude Code is active</div>
              </div>
            </div>
          </div>
          <!-- Session Detail Panel -->
          <div class="sv-detail">
            <div class="sv-detail-header" id="sv-detail-header">
              <div class="sv-detail-empty">
                <div class="empty-state">
                  <div class="empty-state-title">Select a session</div>
                  <div class="empty-state-description">Click a session to view details</div>
                </div>
              </div>
            </div>
            <div class="sv-tabs" id="sv-tabs"></div>
            <div class="sv-content" id="sv-detail-content"></div>
          </div>
        </div>
      </div>

      <!-- File Changes View -->
      <div id="view-file-changes" class="view hidden" role="tabpanel" aria-labelledby="tab-file-changes">
        <div class="fc-container">
          <!-- Sidebar: Sessions + Files -->
          <div class="fc-sidebar">
            <div class="fc-sidebar-header">
              <h3>File Changes</h3>
              <span class="fc-count" id="fc-pending-count">0 pending</span>
            </div>
            <div class="fc-sessions" id="fc-session-list">
              <!-- Session accordions rendered here by JS -->
              <div class="empty-state">
                <div class="empty-state-title">No pending changes</div>
                <div class="empty-state-description">File changes will appear here when Claude Code modifies files</div>
              </div>
            </div>
            <div class="fc-archive-toggle" id="fc-archive-toggle">
              <span class="fc-archive-icon">&#9654;</span>
              <span>Archive</span>
              <span class="fc-archive-count" id="fc-archive-count">0</span>
            </div>
          </div>

          <!-- Main Panel: Diff Viewer -->
          <div class="fc-main">
            <div class="fc-toolbar" id="fc-toolbar">
              <!-- Populated by JS when file is selected -->
            </div>
            <div class="fc-diff-container" id="fc-diff-container">
              <div class="fc-empty-state">
                <div class="fc-empty-icon">&#128196;</div>
                <div class="fc-empty-title">Select a file to view changes</div>
                <div class="fc-empty-tips">
                  <p><strong>Quick tips:</strong></p>
                  <ul>
                    <li>Click a session to expand and see files</li>
                    <li>Click a file to view its diff</li>
                    <li>Use Keep/Revert to manage changes</li>
                    <li>Edit hunks inline before keeping</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- History View -->
      <div id="view-history" class="view hidden" role="tabpanel" aria-labelledby="tab-history">
        <div class="split-view">
          <div class="split-view-left">
            <div class="split-view-header">
              <span class="split-view-title">Files</span>
            </div>
            <div class="split-view-content">
              <div id="history-files-list" class="history-files-list">
                <div class="empty-state">
                  <div class="empty-state-title">No file history</div>
                  <div class="empty-state-description">Version history will appear here</div>
                </div>
              </div>
            </div>
          </div>
          <div class="split-view-right">
            <div class="split-view-header">
              <span class="split-view-title" id="history-title">Version History</span>
            </div>
            <div class="split-view-content">
              <div id="history-versions" class="history-versions">
                <div class="empty-state">
                  <div class="empty-state-title">Select a file</div>
                  <div class="empty-state-description">Click a file to view its version history</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Archived View -->
      <div id="view-archived" class="view hidden" role="tabpanel" aria-labelledby="tab-archived">
        <div class="split-view">
          <div class="split-view-left">
            <div class="split-view-header">
              <span class="split-view-title">Archived Changes</span>
            </div>
            <div class="split-view-content">
              <div id="archived-list" class="archived-list">
                <div class="empty-state">
                  <div class="empty-state-title">No archived changes</div>
                  <div class="empty-state-description">Kept and reverted changes will appear here</div>
                </div>
              </div>
            </div>
          </div>
          <div class="split-view-right">
            <div class="split-view-header">
              <span class="split-view-title" id="archived-title">Details</span>
              <div id="archived-actions" class="btn-group hidden">
                <button id="restore-btn" class="btn btn-sm btn-primary">Restore</button>
              </div>
            </div>
            <div class="split-view-content">
              <div id="archived-viewer" class="archived-viewer">
                <div class="empty-state">
                  <div class="empty-state-title">Select a change</div>
                  <div class="empty-state-description">Click an archived change to view details</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Scripts (loaded in order - dependencies first) -->
  <script nonce="${nonce}" src="${stateJs}"></script>
  <script nonce="${nonce}" src="${routerJs}"></script>
  <script nonce="${nonce}" src="${apiJs}"></script>
  <script nonce="${nonce}" src="${dashboardJs}"></script>
  <script nonce="${nonce}" src="${logsJs}"></script>
  <script nonce="${nonce}" src="${sessionUtilsJs}"></script>
  <script nonce="${nonce}" src="${sessionListJs}"></script>
  <script nonce="${nonce}" src="${activityItemsJs}"></script>
  <script nonce="${nonce}" src="${activityFeedJs}"></script>
  <script nonce="${nonce}" src="${toolDetailJs}"></script>
  <script nonce="${nonce}" src="${sessionDetailJs}"></script>
  <script nonce="${nonce}" src="${sessionsJs}"></script>
  <script nonce="${nonce}" src="${fcSessionListJs}"></script>
  <script nonce="${nonce}" src="${fcDiffViewJs}"></script>
  <script nonce="${nonce}" src="${fcEditorJs}"></script>
  <script nonce="${nonce}" src="${fcActionsJs}"></script>
  <script nonce="${nonce}" src="${fileChangesJs}"></script>
  <script nonce="${nonce}" src="${historyJs}"></script>
  <script nonce="${nonce}" src="${archivedJs}"></script>
  <script nonce="${nonce}" src="${mainJs}"></script>
</body>
</html>`;
}
