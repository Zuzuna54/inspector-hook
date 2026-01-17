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

		// Subscribe to core events
		this._coreBridge.onLog((log) =>
			this._sendMessage({ type: "log", payload: log }),
		);
		this._coreBridge.onStats((stats) =>
			this._sendMessage({ type: "stats", payload: stats }),
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

		this._panel.dispose();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	/**
	 * Handle messages from webview
	 */
	private async _handleMessage(message: WebviewCommand): Promise<void> {
		switch (message.command) {
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

			default:
				// Unknown commands are silently ignored
				break;
		}
	}

	/**
	 * Send message to webview
	 */
	private _sendMessage(message: WebviewMessage): void {
		this._panel.webview.postMessage(message);
	}

	/**
	 * Send initial data to webview
	 */
	private async _sendInitData(): Promise<void> {
		console.log("[Inspector Hook Panel] Fetching initial data...");
		try {
			const [stats, logs, sessions, fileChanges] = await Promise.all([
				this._coreBridge.getStats(),
				this._coreBridge.getLogs({ pagination: { limit: 100 } }),
				this._coreBridge.getSessions(),
				this._coreBridge.getPendingChanges(),
			]);
			console.log("[Inspector Hook Panel] Data received:", {
				stats,
				logsCount: logs?.logs?.length,
				sessionsCount: sessions?.sessions?.length,
				changesCount: fileChanges?.changes?.length,
			});

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
		} catch (error) {
			console.error("[Inspector Hook Panel] Failed to fetch data:", error);
		}
	}

	/**
	 * Update webview content
	 */
	private _update(): void {
		this._panel.webview.html = this._getHtmlContent();
		this._sendInitData();
	}

	/**
	 * Get HTML content for webview
	 */
	private _getHtmlContent(): string {
		const webview = this._panel.webview;

		// Get URIs for styles and scripts
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "media", "styles", "main.css"),
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "media", "scripts", "main.js"),
		);

		// Use a nonce to only allow specific scripts to run
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Inspector Hook</title>
</head>
<body>
  <div id="app">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <span class="status-indicator connected"></span>
        <span class="status-text">Connected</span>
        <span class="stats">
          <span id="stat-errors">0 errors</span>
          <span id="stat-changes">0 changes</span>
        </span>
      </div>
      <div class="header-right">
        <input type="text" id="search" placeholder="Search logs..." class="search-input">
        <button id="clear-btn" class="btn btn-secondary">Clear</button>
      </div>
    </header>

    <!-- Tab Navigation -->
    <nav class="tabs">
      <button class="tab active" data-tab="dashboard">Dashboard</button>
      <button class="tab" data-tab="logs">All Logs</button>
      <button class="tab" data-tab="sessions">Live Sessions</button>
      <button class="tab" data-tab="file-changes">File Changes</button>
    </nav>

    <!-- Main Content -->
    <main class="main">
      <!-- Dashboard View -->
      <div id="dashboard-view" class="view active">
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
        </div>
        <div class="recent-activity">
          <h3>Recent Activity</h3>
          <div id="recent-logs" class="log-list"></div>
        </div>
      </div>

      <!-- Logs View -->
      <div id="logs-view" class="view">
        <div id="logs-table" class="log-table"></div>
      </div>

      <!-- Sessions View -->
      <div id="sessions-view" class="view">
        <div id="sessions-list" class="sessions-list"></div>
      </div>

      <!-- File Changes View -->
      <div id="file-changes-view" class="view">
        <div class="split-view">
          <div class="changes-list" id="changes-list"></div>
          <div class="diff-viewer" id="diff-viewer">
            <div class="empty-state">Select a change to view diff</div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
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
