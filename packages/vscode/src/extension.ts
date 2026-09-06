/**
 * Inspector Hook VS Code Extension
 * Entry point for the extension
 */

import * as vscode from "vscode";
import { registerCommands } from "./commands.js";
import { CoreBridge } from "./core-bridge.js";
import { InspectorPanel } from "./panel.js";

let panel: InspectorPanel | undefined;
let coreBridge: CoreBridge | undefined;

/**
 * Called when the extension is activated
 */
export async function activate(
	context: vscode.ExtensionContext,
): Promise<void> {
	// Get configuration
	const config = vscode.workspace.getConfiguration("inspectorHook");
	const autoStart = config.get<boolean>("autoStart", true);
	const httpPort = config.get<number>("httpPort", 52376);
	// Off by default: these digests are written into the user's own memory
	// files, which shape what future Claude sessions are told.
	const writeSessionMemory = config.get<boolean>("writeSessionMemory", false);

	// Initialize core bridge
	coreBridge = new CoreBridge({
		storagePath: context.globalStorageUri.fsPath,
		// Only a real workspace folder. The previous fallback was process.cwd(),
		// which for the extension host is "/" -- so with no folder open the core
		// was told the workspace root was the filesystem root. Undefined lets the
		// core apply its own default instead of resolving paths against "/".
		workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		httpPort,
		writeSessionMemory,
		extensionPath: context.extensionUri.fsPath,
	});

	// Register commands
	registerCommands(context, {
		showPanel: () => {
			console.log("[InspectorHook Extension] showPanel command triggered");
			panel = InspectorPanel.createOrShow(context.extensionUri, coreBridge!);
			console.log("[InspectorHook Extension] Panel created/shown");
		},
		refreshLogs: () => {
			panel?.refresh();
		},
		clearLogs: async () => {
			await coreBridge?.clearLogs();
			panel?.refresh();
		},
	});

	// Auto-start core if configured
	if (autoStart) {
		try {
			await coreBridge.start();
		} catch (error) {
			vscode.window.showErrorMessage(
				`Inspector Hook: Failed to start core process. ${error instanceof Error ? error.message : ""}`,
			);
		}
	}

	// Show status bar item
	const statusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusBar.text = "$(eye) Inspector Hook";
	statusBar.tooltip = "Click to open Inspector Hook panel";
	statusBar.command = "inspectorHook.showPanel";
	statusBar.show();
	context.subscriptions.push(statusBar);

	// Update status bar with stats
	const updateStatusBar = async () => {
		if (coreBridge?.isRunning()) {
			try {
				const stats = await coreBridge.getStats();
				statusBar.text = `$(eye) ${stats?.errors || 0} errors | ${stats?.pendingChanges || 0} changes`;
			} catch {
				statusBar.text = "$(eye) Inspector Hook";
			}
		} else {
			statusBar.text = "$(eye) Inspector Hook (stopped)";
		}
	};

	// Update status bar periodically
	const interval = setInterval(updateStatusBar, 5000);
	context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

/**
 * Called when the extension is deactivated
 */
export function deactivate(): void {
	// Stop core process
	coreBridge?.stop();

	// Dispose panel
	panel?.dispose();
}
