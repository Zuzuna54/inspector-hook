#!/usr/bin/env node

/**
 * CLI entry point for Inspector Hook Core
 * Starts the core process and outputs ready JSON with port info
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CoreInitParams } from "@inspector-hook/protocol";
import { InspectorCore } from "./core.js";

// Default configuration (can be overridden via environment variables)
const DEFAULT_CONFIG = {
	// Prefer the documented default so hook URLs stay stable; HttpServer scans
	// upward if it is taken. Set to 0 explicitly to always let the OS choose.
	httpPort: parseInt(process.env.INSPECTOR_HOOK_HTTP_PORT || "52376", 10),
	wsPort: parseInt(process.env.INSPECTOR_HOOK_WS_PORT || "0", 10),
	maxLogsInMemory: parseInt(process.env.INSPECTOR_HOOK_MAX_LOGS || "10000", 10),
	logRetentionDays: parseInt(process.env.INSPECTOR_HOOK_RETENTION_DAYS || "7", 10),
};

// Get storage path (shared across sessions).
// INSPECTOR_HOOK_STORAGE overrides it, which is what lets a second core run
// against its own store instead of writing into the user's real history.
function getStoragePath(): string {
	const basePath =
		process.env.INSPECTOR_HOOK_STORAGE || join(homedir(), ".inspector-hook");
	if (!existsSync(basePath)) {
		mkdirSync(basePath, { recursive: true });
	}
	return basePath;
}

// Get workspace root (from env or current directory)
function getWorkspaceRoot(): string {
	return process.env.INSPECTOR_HOOK_WORKSPACE || process.cwd();
}

// Write the port where hooks can discover it.
//
// The path is overridable via INSPECTOR_HOOK_PORT_FILE. Without that, any
// second core -- a test run, a scratch instance -- overwrites the single global
// file and silently redirects every hook on the machine at itself, breaking
// capture for the real instance until it restarts.
function getPortFilePath(): string {
	return process.env.INSPECTOR_HOOK_PORT_FILE || "/tmp/inspector-hook.port";
}

function writePortFile(port: number): void {
	writeFileSync(getPortFilePath(), port.toString(), "utf-8");
}

async function main(): Promise<void> {
	const storagePath = getStoragePath();
	const workspaceRoot = getWorkspaceRoot();

	const params: CoreInitParams = {
		config: DEFAULT_CONFIG,
		storagePath,
		workspaceRoot,
	};

	const core = new InspectorCore(params);

	try {
		await core.start();

		const port = core.getHttpPort();

		// Write port file for hook scripts
		writePortFile(port);

		// Output ready JSON for parent process (VS Code extension)
		const readyMessage = JSON.stringify({ type: "ready", port });
		process.stdout.write(readyMessage + "\n");

		// Handle shutdown signals
		const shutdown = async () => {
			await core.stop();
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		// Keep process alive - stdin is used for IPC
		process.stdin.resume();
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		process.stderr.write(`Error starting core: ${errorMessage}\n`);
		process.exit(1);
	}
}

main();
