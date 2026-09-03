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
import { buildWebviewHtml } from "./webview-html.js";

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
				// api.js has always sent `line` and this dropped it, so clicking a
				// diff hunk or a log entry opened the file at the top rather than
				// at the place it referred to.
				const openParams = message.params as {
					filePath: string;
					line?: number;
				};
				const uri = vscode.Uri.file(openParams.filePath);
				const doc = await vscode.workspace.openTextDocument(uri);

				// The webview counts lines from 1; vscode.Position counts from 0.
				// Clamped to the document, because a line from a stale diff can
				// point past the end of a file that has since been edited.
				const requested = Number(openParams.line);
				const options: vscode.TextDocumentShowOptions = {};
				if (Number.isFinite(requested) && requested >= 1) {
					const zeroBased = Math.min(
						Math.trunc(requested) - 1,
						Math.max(doc.lineCount - 1, 0),
					);
					const position = new vscode.Position(zeroBased, 0);
					options.selection = new vscode.Range(position, position);
				}
				await vscode.window.showTextDocument(doc, options);
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
				// since/before/limit are optional and forwarded when present, so
				// the webview can poll incrementally and backfill without a
				// separate message type. Omitting them is the full-window fetch
				// the view has always done.
				const params = message.params as {
					sessionId: string;
					since?: string;
					before?: string;
					limit?: number;
				};
				const activity = await this._coreBridge.getSessionActivity(
					params.sessionId,
					{ since: params.since, before: params.before, limit: params.limit },
				);
				this._sendMessage({ type: "session-activity", payload: activity });
				break;
			}

			// ----------------------------------------------------------------
			// Native auto memory (Milestone 3)
			//
			// The four mutating cases all reply as "memory-result" with the
			// core's response passed through UNCHANGED, including `reason`. The
			// view renders refusals verbatim, so rewording one here would mean
			// two explanations of the same refusal drifting apart.
			// ----------------------------------------------------------------

			case "memory-get-projects": {
				const projects = await this._coreBridge.getMemoryProjects(
					Boolean((message.params as any)?.includeEmpty),
				);
				this._sendMessage({ type: "memory-projects", payload: projects });
				break;
			}

			case "memory-add-to-index": {
				const p = message.params as { memoryDir: string; fileName: string };
				const result = await this._coreBridge.addMemoryToIndex(
					p.memoryDir,
					p.fileName,
				);
				this._sendMessage({ type: "memory-result", payload: result });
				break;
			}

			case "memory-remove-from-index": {
				const p = message.params as { memoryDir: string; fileName: string };
				const result = await this._coreBridge.removeMemoryFromIndex(
					p.memoryDir,
					p.fileName,
				);
				this._sendMessage({ type: "memory-result", payload: result });
				break;
			}

			case "memory-write": {
				const result = await this._coreBridge.writeMemory(
					message.params as {
						memoryDir: string;
						name: string;
						description?: string;
						type?: string;
						body?: string;
						title?: string;
						userInitiated?: boolean;
					},
				);
				this._sendMessage({ type: "memory-result", payload: result });
				break;
			}

			case "memory-delete": {
				const p = message.params as {
					memoryDir: string;
					fileName: string;
					force?: boolean;
				};
				const result = await this._coreBridge.deleteMemory(
					p.memoryDir,
					p.fileName,
					Boolean(p.force),
				);
				this._sendMessage({ type: "memory-result", payload: result });
				break;
			}

			// The three staging calls share one reply type on purpose: each ends
			// with "here is what is staged, or nothing", so the view re-renders
			// from whatever came back. The staged object is passed through
			// untouched — rebuilding it here would quietly break the guarantee
			// that the preview is the delivery.
			case "memory-stage-context": {
				const staged = await this._coreBridge.stageContext(
					message.params as {
						sessionId?: string;
						text?: string;
						label?: string;
						ttlMs?: number;
					},
				);
				this._sendMessage({ type: "memory-staged", payload: staged });
				break;
			}

			case "memory-get-staged": {
				const staged = await this._coreBridge.getStagedContext();
				this._sendMessage({ type: "memory-staged", payload: staged });
				break;
			}

			case "memory-clear-staged": {
				await this._coreBridge.clearStagedContext();
				this._sendMessage({ type: "memory-staged", payload: null });
				break;
			}

			case "memory-build-digest": {
				// Only the sessionId is forwarded. A `write` flag in the params
				// is deliberately ignored rather than passed through.
				const digest = await this._coreBridge.buildSessionDigest(
					(message.params as { sessionId: string }).sessionId,
				);
				this._sendMessage({ type: "memory-digest", payload: digest });
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

			case "get-version-content": {
				// Always answer, including on a miss: history.js clears its
				// per-version loading flag from this response, so a silent
				// no-reply leaves that version stuck on "Loading..." forever.
				const filePath = (message.params as any).filePath;
				const versionNumber = (message.params as any).versionNumber;
				const result = await this._coreBridge.getVersionContent(
					filePath,
					versionNumber,
				);
				this._sendMessage({
					type: "version-content",
					payload: result ?? {
						filePath,
						versionNumber,
						content: null,
						error: "Version content not found",
					},
				});
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

			case "compare-version-to-disk": {
				const filePath = (message.params as any).filePath;
				const versionNumber = (message.params as any).versionNumber;

				try {
					// Use compareVersions with "current" to compare to disk
					const result = await this._coreBridge.compareVersions(
						filePath,
						versionNumber,
						"current",
					);
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

			case "delete-version": {
				const filePath = (message.params as any).filePath;
				const versionNumber = (message.params as any).versionNumber;

				try {
					const result = await this._coreBridge.deleteVersion(
						filePath,
						versionNumber,
					);
					this._sendMessage({ type: "delete-version-result", payload: result });
					// Refresh version history after deletion
					const history = await this._coreBridge.getVersionHistory(filePath);
					const payload = history || { filePath, versions: [] };
					this._sendMessage({ type: "version-history", payload });
				} catch (error) {
					this._sendMessage({
						type: "delete-version-result",
						payload: { success: false, error: String(error) },
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
		return buildWebviewHtml(this._panel.webview, this._extensionUri);
	}
}

