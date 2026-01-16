/**
 * Command Registration
 * Registers all VS Code commands for Inspector Hook
 */

import * as vscode from "vscode";

export interface CommandHandlers {
	showPanel: () => void;
	refreshLogs: () => void;
	clearLogs: () => Promise<void>;
}

/**
 * Register all extension commands
 */
export function registerCommands(
	context: vscode.ExtensionContext,
	handlers: CommandHandlers,
): void {
	// Show Panel command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"inspectorHook.showPanel",
			handlers.showPanel,
		),
	);

	// Refresh Logs command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"inspectorHook.refreshLogs",
			handlers.refreshLogs,
		),
	);

	// Clear Logs command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"inspectorHook.clearLogs",
			handlers.clearLogs,
		),
	);
}
