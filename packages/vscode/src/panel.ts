/**
 * Inspector Hook Webview Panel
 * Manages the webview panel for displaying logs and file changes
 */

import type {
	LogEntry,
	Stats,
	WebviewCommand,
	WebviewMessage,
} from "@inspector-hook/protocol";
import * as vscode from "vscode";
import type { CoreBridge } from "./core-bridge.js";

export class InspectorPanel {
	public static currentPanel: InspectorPanel | undefined;

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private readonly _coreBridge: CoreBridge;
	private _disposables: vscode.Disposable[] = [];
	private _webviewReady = false;
	private _messageQueue: WebviewMessage[] = [];
	private _eventCleanups: (() => void)[] = [];

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		coreBridge: CoreBridge,
	) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._coreBridge = coreBridge;

		// Set webview content
		this._update();

		// Listen for panel disposal
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from webview
		this._panel.webview.onDidReceiveMessage(
			(message: WebviewCommand) => this._handleMessage(message),
			null,
			this._disposables,
		);

		// Subscribe to core events with cleanup tracking
		const logHandler = (log: LogEntry) => {
			this._sendMessage({ type: "log", payload: log });
		};
		const statsHandler = (stats: Stats) => {
			this._sendMessage({ type: "stats", payload: stats });
		};
		const sessionHandler = (session: unknown) => {
			this._sendMessage({ type: "session", payload: session });
		};
		const fileChangeHandler = (change: unknown) => {
			this._sendMessage({ type: "fileChange", payload: change });
		};

		this._coreBridge.onLog(logHandler);
		this._coreBridge.onStats(statsHandler);
		this._coreBridge.onSession(sessionHandler);
		this._coreBridge.onFileChange(fileChangeHandler);

		// Track cleanup functions
		this._eventCleanups.push(
			() => this._coreBridge.off("log", logHandler),
			() => this._coreBridge.off("stats", statsHandler),
			() => this._coreBridge.off("session", sessionHandler),
			() => this._coreBridge.off("fileChange", fileChangeHandler),
		);
	}

	/**
	 * Create or show the panel
	 */
	public static createOrShow(
		extensionUri: vscode.Uri,
		coreBridge: CoreBridge,
	): InspectorPanel {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If panel exists, show it
		if (InspectorPanel.currentPanel) {
			InspectorPanel.currentPanel._panel.reveal(column);
			return InspectorPanel.currentPanel;
		}

		// Create new panel
		const panel = vscode.window.createWebviewPanel(
			"inspectorHook",
			"Inspector Hook",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
			},
		);

		InspectorPanel.currentPanel = new InspectorPanel(
			panel,
			extensionUri,
			coreBridge,
		);
		return InspectorPanel.currentPanel;
	}

	/**
	 * Refresh the panel content
	 */
	public refresh(): void {
		this._sendInitData();
	}

	/**
	 * Dispose the panel
	 */
	public dispose(): void {
		InspectorPanel.currentPanel = undefined;

		// Clean up event subscriptions from CoreBridge
		for (const cleanup of this._eventCleanups) {
			cleanup();
		}
		this._eventCleanups = [];

		this._panel.dispose();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}

		// Clear message queue
		this._messageQueue = [];
		this._webviewReady = false;
	}

	/**
	 * Handle messages from webview
	 */
	private async _handleMessage(message: WebviewCommand): Promise<void> {
		switch (message.command) {
			case "webview-ready": {
				this._webviewReady = true;
				// Send a ping to verify communication works
				this._panel.webview.postMessage({
					type: "ping",
					payload: { timestamp: Date.now() },
				});
				// Send init data now that webview is ready
				await this._sendInitData();
				// Flush any queued messages
				this._flushMessageQueue();
				break;
			}

			case "pong": {
				// Pong received from webview - communication verified
				break;
			}

			case "get-logs": {
				const logs = await this._coreBridge.getLogs(message.params as any);
				this._sendMessage({ type: "logs", payload: logs });
				break;
			}

			case "get-diff": {
				const changeId = (message.params as any).changeId;
				try {
					const diff = await this._coreBridge.getDiff(changeId);
					// Include changeId in the response so webview can match it
					this._sendMessage({
						type: "diff-result",
						payload: { ...diff, changeId },
					});
				} catch (error) {
					this._sendMessage({
						type: "diff-error",
						payload: { changeId, message: String(error) },
					});
				}
				break;
			}

			case "keep-change":
				await this._coreBridge.keepChange((message.params as any).changeId);
				this.refresh();
				break;

			case "revert-change":
				await this._coreBridge.revertChange((message.params as any).changeId);
				this.refresh();
				break;

			case "open-file": {
				const uri = vscode.Uri.file((message.params as any).filePath);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
				break;
			}

			case "clear-logs":
				await this._coreBridge.clearLogs((message.params as any)?.filter);
				this.refresh();
				break;

			case "get-sessions": {
				const sessions = await this._coreBridge.getSessions(
					message.params as any,
				);
				this._sendMessage({ type: "sessions", payload: sessions });
				break;
			}

			case "get-session": {
				const session = await this._coreBridge.getSession(
					(message.params as any).sessionId,
				);
				this._sendMessage({ type: "session", payload: session });
				break;
			}

			case "get-session-logs": {
				const sessionLogs = await this._coreBridge.getSessionLogs(
					(message.params as any).sessionId,
				);
				this._sendMessage({ type: "session-logs", payload: sessionLogs });
				break;
			}

			case "get-session-activity": {
				const activity = await this._coreBridge.getSessionActivity(
					(message.params as any).sessionId,
				);
				this._sendMessage({ type: "session-activity", payload: activity });
				break;
			}

			case "delete-session": {
				const result = await this._coreBridge.deleteSession(
					(message.params as any).sessionId,
				);
				this._sendMessage({ type: "delete-session-result", payload: result });
				this.refresh();
				break;
			}

			case "get-file-changes": {
				const changes = await this._coreBridge.getPendingChanges(
					message.params as any,
				);
				this._sendMessage({ type: "fileChanges", payload: changes });
				break;
			}

			case "keep-all-changes": {
				const result = await this._coreBridge.keepAllChanges(
					(message.params as any)?.sessionId,
				);
				this._sendMessage({ type: "keep-all-result", payload: result });
				this.refresh();
				break;
			}

			case "revert-all-changes": {
				const result = await this._coreBridge.revertAllChanges(
					(message.params as any)?.sessionId,
				);
				this._sendMessage({ type: "revert-all-result", payload: result });
				this.refresh();
				break;
			}

			case "update-change-content": {
				const result = await this._coreBridge.updateChangeContent(
					(message.params as any).changeId,
					(message.params as any).afterContent,
				);
				this._sendMessage({ type: "update-content-result", payload: result });
				break;
			}

			case "keep-hunk": {
				// Per-hunk operations - for now, keep the whole change
				// Future: implement per-hunk backend support
				const result = await this._coreBridge.keepChange(
					(message.params as any).changeId,
				);
				this._sendMessage({ type: "keep-hunk-result", payload: result });
				this.refresh();
				break;
			}

			case "revert-hunk": {
				// Per-hunk operations - for now, revert the whole change
				// Future: implement per-hunk backend support
				const result = await this._coreBridge.revertChange(
					(message.params as any).changeId,
				);
				this._sendMessage({ type: "revert-hunk-result", payload: result });
				this.refresh();
				break;
			}

			case "get-tracked-files": {
				const result = await this._coreBridge.getTrackedFiles();
				this._sendMessage({ type: "tracked-files", payload: result });
				break;
			}

			case "get-version-history": {
				const filePath = (message.params as any).filePath;
				const history = await this._coreBridge.getVersionHistory(
					filePath,
					(message.params as any).limit,
				);
				// Handle null response by sending empty versions
				const payload = history || { filePath, versions: [] };
				this._sendMessage({ type: "version-history", payload });
				break;
			}

			case "restore-version": {
				const result = await this._coreBridge.restoreVersion(
					(message.params as any).filePath,
					(message.params as any).versionNumber,
				);
				this._sendMessage({ type: "restore-result", payload: result });
				this.refresh();
				break;
			}

			case "compare-versions": {
				const filePath = (message.params as any).filePath;
				const v1 = (message.params as any).v1;
				const v2 = (message.params as any).v2;

				try {
					const result = await this._coreBridge.compareVersions(
						filePath,
						v1,
						v2,
					);
					// Extract just the diff from the result
					const diff = result?.diff || null;
					this._sendMessage({ type: "version-comparison", payload: { diff } });
				} catch (error) {
					this._sendMessage({
						type: "version-comparison",
						payload: { diff: null, error: String(error) },
					});
				}
				break;
			}

			case "get-archived-changes": {
				const archived = await this._coreBridge.getArchivedChanges(
					message.params as any,
				);
				this._sendMessage({ type: "archived", payload: archived });
				break;
			}

			case "restore-archived": {
				const result = await this._coreBridge.restoreArchived(
					(message.params as any).changeId,
				);
				this._sendMessage({ type: "restore-archived-result", payload: result });
				this.refresh();
				break;
			}

			default:
				// Unknown commands are silently ignored
				break;
		}
	}

	/**
	 * Send message to webview (queues if not ready)
	 */
	private _sendMessage(message: WebviewMessage): void {
		if (!this._webviewReady) {
			// Queue message until webview is ready
			this._messageQueue.push(message);
			return;
		}
		this._panel.webview.postMessage(message);
	}

	/**
	 * Flush queued messages to webview
	 */
	private _flushMessageQueue(): void {
		for (const message of this._messageQueue) {
			this._panel.webview.postMessage(message);
		}
		this._messageQueue = [];
	}

	/**
	 * Send initial data to webview
	 */
	private async _sendInitData(): Promise<void> {
		if (!this._coreBridge.isRunning()) {
			try {
				await this._coreBridge.start();
			} catch (_startError) {
				return;
			}
		}

		try {
			const stats = await this._coreBridge.getStats();
			const logs = await this._coreBridge.getLogs({
				pagination: { limit: 100 },
			});
			const sessions = await this._coreBridge.getSessions();
			const fileChanges = await this._coreBridge.getPendingChanges();

			this._sendMessage({
				type: "init",
				payload: {
					stats,
					logs: logs?.logs || [],
					sessions: sessions?.sessions || [],
					fileChanges: fileChanges?.changes || [],
					config: { autoScroll: true },
				},
			});
		} catch (_error) {
			// Failed to fetch initial data
		}
	}

	/**
	 * Update webview content
	 */
	private _update(): void {
		this._panel.webview.html = this._getHtmlContent();
		// Don't send init data here - wait for webview-ready signal
		// The webview will send 'webview-ready' when it's initialized
	}

	/**
	 * Get HTML content for webview
	 */
	private _getHtmlContent(): string {
		const webview = this._panel.webview;

		// Helper to get webview URI
		const getUri = (...paths: string[]) =>
			webview.asWebviewUri(
				vscode.Uri.joinPath(this._extensionUri, "media", ...paths),
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
		// Note: file-changes.js, history.js, archived.js created by Agent 2
		const fileChangesJs = getUri("scripts", "views", "file-changes.js");
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
  <script nonce="${nonce}" src="${sessionsJs}"></script>
  <script nonce="${nonce}" src="${fileChangesJs}"></script>
  <script nonce="${nonce}" src="${historyJs}"></script>
  <script nonce="${nonce}" src="${archivedJs}"></script>
  <script nonce="${nonce}" src="${mainJs}"></script>
</body>
</html>`;
	}
}

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
