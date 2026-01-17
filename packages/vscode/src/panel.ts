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
		console.log("[InspectorPanel] createOrShow called");
		console.log("[InspectorPanel] extensionUri:", extensionUri.fsPath);
		console.log("[InspectorPanel] coreBridge running:", coreBridge.isRunning());

		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If panel exists, show it
		if (InspectorPanel.currentPanel) {
			console.log("[InspectorPanel] Panel already exists, revealing");
			InspectorPanel.currentPanel._panel.reveal(column);
			return InspectorPanel.currentPanel;
		}

		// Create new panel
		console.log("[InspectorPanel] Creating new webview panel...");
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
		console.log("[InspectorPanel] Webview panel created");

		InspectorPanel.currentPanel = new InspectorPanel(
			panel,
			extensionUri,
			coreBridge,
		);
		console.log("[InspectorPanel] Panel instance created, waiting for webview-ready...");
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
				console.log("[InspectorPanel] Received webview-ready signal");
				this._webviewReady = true;
				// Send a ping to verify communication works
				this._panel.webview.postMessage({ type: "ping", payload: { timestamp: Date.now() } });
				console.log("[InspectorPanel] Sent ping to webview");
				// Send init data now that webview is ready
				await this._sendInitData();
				// Flush any queued messages
				this._flushMessageQueue();
				break;
			}

			case "pong": {
				console.log("[InspectorPanel] Received pong from webview:", message.params);
				break;
			}

			case "get-logs": {
				const logs = await this._coreBridge.getLogs(message.params as any);
				this._sendMessage({ type: "logs", payload: logs });
				break;
			}

			case "get-diff": {
				const diff = await this._coreBridge.getDiff(
					(message.params as any).changeId,
				);
				this._sendMessage({ type: "diff-result", payload: diff });
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
				const sessions = await this._coreBridge.getSessions(message.params as any);
				this._sendMessage({ type: "sessions", payload: sessions });
				break;
			}

			case "get-session": {
				const session = await this._coreBridge.getSession(
					(message.params as any).sessionId
				);
				this._sendMessage({ type: "session", payload: session });
				break;
			}

			case "delete-session": {
				const result = await this._coreBridge.deleteSession(
					(message.params as any).sessionId
				);
				this._sendMessage({ type: "delete-session-result", payload: result });
				this.refresh();
				break;
			}

			case "get-file-changes": {
				const changes = await this._coreBridge.getPendingChanges(message.params as any);
				this._sendMessage({ type: "fileChanges", payload: changes });
				break;
			}

			case "keep-all-changes": {
				const result = await this._coreBridge.keepAllChanges(
					(message.params as any)?.sessionId
				);
				this._sendMessage({ type: "keep-all-result", payload: result });
				this.refresh();
				break;
			}

			case "revert-all-changes": {
				const result = await this._coreBridge.revertAllChanges(
					(message.params as any)?.sessionId
				);
				this._sendMessage({ type: "revert-all-result", payload: result });
				this.refresh();
				break;
			}

			case "get-version-history": {
				const history = await this._coreBridge.getVersionHistory(
					(message.params as any).filePath,
					(message.params as any).limit
				);
				this._sendMessage({ type: "version-history", payload: history });
				break;
			}

			case "restore-version": {
				const result = await this._coreBridge.restoreVersion(
					(message.params as any).filePath,
					(message.params as any).versionNumber
				);
				this._sendMessage({ type: "restore-result", payload: result });
				this.refresh();
				break;
			}

			case "compare-versions": {
				const diff = await this._coreBridge.compareVersions(
					(message.params as any).filePath,
					(message.params as any).v1,
					(message.params as any).v2
				);
				this._sendMessage({ type: "version-comparison", payload: { diff } });
				break;
			}

			case "get-archived-changes": {
				const archived = await this._coreBridge.getArchivedChanges(message.params as any);
				this._sendMessage({ type: "archived", payload: archived });
				break;
			}

			case "restore-archived": {
				const result = await this._coreBridge.restoreArchived(
					(message.params as any).changeId
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
		console.log("[InspectorPanel] _sendInitData called, coreBridge running:", this._coreBridge.isRunning());

		if (!this._coreBridge.isRunning()) {
			console.error("[InspectorPanel] CoreBridge is NOT running! Trying to start...");
			try {
				await this._coreBridge.start();
				console.log("[InspectorPanel] CoreBridge started successfully");
			} catch (startError) {
				console.error("[InspectorPanel] Failed to start CoreBridge:", startError);
				return;
			}
		}

		try {
			console.log("[InspectorPanel] Fetching stats...");
			const stats = await this._coreBridge.getStats();
			console.log("[InspectorPanel] Stats:", stats);

			console.log("[InspectorPanel] Fetching logs...");
			const logs = await this._coreBridge.getLogs({ pagination: { limit: 100 } });
			console.log("[InspectorPanel] Logs count:", logs?.logs?.length);

			console.log("[InspectorPanel] Fetching sessions...");
			const sessions = await this._coreBridge.getSessions();
			console.log("[InspectorPanel] Sessions count:", sessions?.sessions?.length);

			console.log("[InspectorPanel] Fetching file changes...");
			const fileChanges = await this._coreBridge.getPendingChanges();
			console.log("[InspectorPanel] File changes count:", fileChanges?.changes?.length);

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
			console.log("[InspectorPanel] Init message sent to webview");
		} catch (error) {
			console.error("[InspectorPanel] Failed to fetch data:", error);
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
        <div id="sessions-list" class="sessions-list">
          <div class="empty-state">
            <div class="empty-state-title">Loading sessions...</div>
          </div>
        </div>
      </div>

      <!-- File Changes View -->
      <div id="view-file-changes" class="view hidden" role="tabpanel" aria-labelledby="tab-file-changes">
        <div class="split-view">
          <div class="split-view-left">
            <div class="split-view-header">
              <span class="split-view-title">Pending Changes</span>
              <div class="btn-group">
                <button id="keep-all-btn" class="btn btn-sm btn-success">Keep All</button>
                <button id="revert-all-btn" class="btn btn-sm btn-danger">Revert All</button>
              </div>
            </div>
            <div class="split-view-content">
              <div id="changes-list" class="changes-list">
                <div class="empty-state">
                  <div class="empty-state-title">No pending changes</div>
                  <div class="empty-state-description">File changes will appear here</div>
                </div>
              </div>
            </div>
          </div>
          <div class="split-view-right">
            <div class="split-view-header">
              <span class="split-view-title" id="diff-title">Diff</span>
              <div id="diff-actions" class="btn-group hidden">
                <button id="keep-btn" class="btn btn-sm btn-success">Keep</button>
                <button id="revert-btn" class="btn btn-sm btn-danger">Revert</button>
              </div>
            </div>
            <div class="split-view-content">
              <div id="diff-viewer" class="diff-viewer">
                <div class="empty-state">
                  <div class="empty-state-title">Select a change</div>
                  <div class="empty-state-description">Click a file to view its diff</div>
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
