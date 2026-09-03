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

// Get storage path (shared across sessions)
function getStoragePath(): string {
	const basePath = join(homedir(), ".inspector-hook");
	if (!existsSync(basePath)) {
		mkdirSync(basePath, { recursive: true });
	}
	return basePath;
}

// Get workspace root (from env or current directory)
function getWorkspaceRoot(): string {
	return process.env.INSPECTOR_HOOK_WORKSPACE || process.cwd();
}

// Write port to file for hooks to discover
// Uses fixed path /tmp/inspector-hook.port as per Phase 1 spec
function writePortFile(port: number): void {
	const portFile = "/tmp/inspector-hook.port";
	writeFileSync(portFile, port.toString(), "utf-8");
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
