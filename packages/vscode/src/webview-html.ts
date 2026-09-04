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

	// Asset manifests. Order matters for scripts: a module must load before
	// anything that references it at parse time.
	//
	// Every entry is individually optional -- a path that does not exist yet is
	// a 404 the webview ignores -- so a tag can land before the file it names.
	// That is deliberate: it lets the split of a large view proceed one module
	// at a time without a broken intermediate state, and it is why these are
	// real <link>/<script> tags rather than CSS @import. An @import with a
	// wrong path fails silently and takes the whole stylesheet with it; a
	// missing tag here costs only the one file.
	//
	// The cost of that tolerance is that a typo is free and permanent, and two
	// entries did exactly that -- naming a stylesheet and a script nobody ever
	// wrote. So test/manifest.test.js now requires every path to exist unless
	// it is named in that file's PENDING map with a reason. The tolerance is
	// intact; it just has to be claimed rather than assumed.
	const styles: string[][] = [
		["styles", "variables.css"],
		["styles", "layout.css"],
		["styles", "components.css"],
		["styles", "components", "controls.css"],
		["styles", "components", "data-display.css"],
		["styles", "components", "feedback.css"],
		["styles", "components", "nav.css"],
		["styles", "prism-theme.css"],
		["styles", "views", "dashboard.css"],
		["styles", "views", "logs.css"],
		["styles", "views", "sessions.css"],
		["styles", "views", "sessions", "list.css"],
		["styles", "views", "sessions", "feed.css"],
		["styles", "views", "sessions", "tool-detail.css"],
		["styles", "views", "sessions", "detail.css"],
		["styles", "views", "file-changes.css"],
		["styles", "views", "file-changes", "layout.css"],
		["styles", "views", "file-changes", "sidebar.css"],
		["styles", "views", "file-changes", "diff.css"],
		["styles", "views", "file-changes", "edit.css"],
		["styles", "views", "history.css"],
		["styles", "views", "history", "layout.css"],
		["styles", "views", "history", "accordion.css"],
		["styles", "views", "history", "viewer.css"],
		["styles", "views", "history", "diff.css"],
		["styles", "views", "archived.css"],
		["styles", "views", "archived", "layout.css"],
		["styles", "views", "archived", "accordion.css"],
		["styles", "views", "archived", "preview.css"],
		["styles", "views", "context.css"],
	];

	const scripts: string[][] = [
		["scripts", "state.js"],
		["scripts", "router.js"],
		["scripts", "api.js"],
		// Shared helpers, before every view that uses them.
		["scripts", "session-utils.js"],
		["scripts", "shared", "diff-render.js"],
		["scripts", "views", "dashboard.js"],
		["scripts", "views", "logs.js"],
		// Sessions modules load before sessions.js.
		["scripts", "views", "sessions", "session-list.js"],
		["scripts", "views", "sessions", "activity-items.js"],
		["scripts", "views", "sessions", "activity-feed.js"],
		["scripts", "views", "sessions", "tool-detail.js"],
		["scripts", "views", "sessions", "session-detail.js"],
		["scripts", "views", "sessions.js"],
		// File-changes modules load before file-changes.js.
		["scripts", "views", "file-changes", "fc-session-list.js"],
		["scripts", "views", "file-changes", "fc-diff-render.js"],
		["scripts", "views", "file-changes", "fc-diff-view.js"],
		["scripts", "views", "file-changes", "fc-editor.js"],
		["scripts", "views", "file-changes", "fc-actions.js"],
		["scripts", "views", "file-changes.js"],
		// History modules load before history.js.
		["scripts", "views", "history", "file-list.js"],
		["scripts", "views", "history", "version-list.js"],
		["scripts", "views", "history", "diff-render.js"],
		["scripts", "views", "history", "diff-viewer.js"],
		["scripts", "views", "history", "virtual-scroll.js"],
		["scripts", "views", "history", "restore.js"],
		["scripts", "views", "history.js"],
		["scripts", "views", "archived.js"],
		// Context modules load before context.js.
		["scripts", "views", "context", "memory-render.js"],
		["scripts", "views", "context", "curation.js"],
		["scripts", "views", "context.js"],
		// main.js wires everything up and must be last.
		["scripts", "main.js"],
	];

	// Use a nonce to only allow specific scripts to run
	const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">

  <!-- Stylesheets, from the styles manifest above -->
${styles.map((path) => `  <link href="${getUri(...path)}" rel="stylesheet">`).join("\n")}

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

    <div class="app-body">
    <!-- Grouped navigation.
         Items keep class="tab" and data-view: router.js and main.js both select
         on .tab, so grouping is a markup and styling change only. The groups are
         sized for what is coming - Knowledge holds Context (M3) and Build holds
         Agents/Builds/Quality (M5-M7) - and an unbuilt view is simply absent
         rather than stubbed, so nothing in the nav points at nothing. -->
    <nav class="sidebar" role="tablist" aria-label="View navigation">
      <div class="nav-group">
        <div class="nav-group-label" id="nav-group-monitor">Monitor</div>
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
      </div>
      <div class="nav-group">
        <div class="nav-group-label" id="nav-group-knowledge">Knowledge</div>
        <button class="tab" data-view="context" role="tab" aria-selected="false" tabindex="-1">
          Context
        </button>
      </div>
      <div class="nav-group">
        <div class="nav-group-label" id="nav-group-changes">Changes</div>
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
      </div>
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

      <!-- Context View: native auto memory, across every project -->
      <div id="view-context" class="view hidden" role="tabpanel" aria-labelledby="nav-group-knowledge">
        <div class="ctx-bar">
          <!-- Static chrome. These were rendered by JS, which meant that if the
               view's init did not run there was nothing to click and nothing to
               explain why — a blank pane with no way out. Buttons that always
               exist fail visibly instead: JS only sets which one is active. -->
          <div class="ctx-mode-toggle" id="ctx-mode-toggle" role="group" aria-label="Context mode">
            <button class="ctx-mode active" data-mode="memory">Memory</button>
            <button class="ctx-mode" data-mode="injection">Context injection</button>
          </div>
          <input type="text" id="ctx-search" class="input ctx-search"
                 placeholder="Search every project's memory..."
                 aria-label="Search memory across all projects">
        </div>
        <div class="ctx-injection-pane" id="ctx-injection-pane">
          <div class="ctx-notice">Loading sessions…</div>
        </div>
        <div class="ctx-status" id="ctx-status"></div>
        <div class="ctx-container">
          <div class="ctx-projects">
            <div class="ctx-pane-header"><h3>Projects</h3></div>
            <div class="ctx-list" id="ctx-project-list"></div>
          </div>
          <div class="ctx-files">
            <div class="ctx-pane-header"><h3>Memory</h3></div>
            <div class="ctx-list" id="ctx-file-list"></div>
          </div>
          <div class="ctx-detail-pane">
            <div id="ctx-result"></div>
            <div id="ctx-detail"></div>
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
  </div>

  <!-- Scripts (loaded in order - dependencies first) -->
${scripts.map((path) => `  <script nonce="${nonce}" src="${getUri(...path)}"></script>`).join("\n")}
</body>
</html>`;
}
