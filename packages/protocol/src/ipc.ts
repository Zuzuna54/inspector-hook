/**
 * Transport: JSON-RPC, WebSocket, webview messaging, error codes, core config.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */

import type { Stats } from "./log.js";

// =============================================================================
// IPC Message Types (JSON-RPC 2.0)
// =============================================================================

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: unknown;
}


/**
 * JSON-RPC 2.0 Success Response
 */
export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number;
	result: unknown;
}


/**
 * JSON-RPC 2.0 Error
 */
export interface JsonRpcErrorDetail {
	code: number;
	message: string;
	data?: unknown;
}


/**
 * JSON-RPC 2.0 Error Response
 */
export interface JsonRpcError {
	jsonrpc: "2.0";
	id: string | number;
	error: JsonRpcErrorDetail;
}


/**
 * JSON-RPC 2.0 Notification (no response expected)
 */
export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

// =============================================================================
// WebSocket Event Types
// =============================================================================

/**
 * WebSocket event format
 */
export interface WebSocketEvent<T = unknown> {
	type: string;
	payload: T;
	timestamp: string;
}

// =============================================================================
// Webview Message Types
// =============================================================================

/**
 * Message from wrapper to webview
 */
export interface WebviewMessage<T = unknown> {
	type: string;
	payload?: T;
}


/**
 * Command from webview to wrapper
 */
export interface WebviewCommand<T = unknown> {
	command: string;
	params?: T;
}

// =============================================================================
// Error Codes
// =============================================================================

export const ErrorCodes = {
	// JSON-RPC standard errors
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	SERVER_ERROR: -32000,

	// Application errors
	NOT_FOUND: 1000,
	ALREADY_EXISTS: 1001,
	VALIDATION_ERROR: 1002,
	FILE_ERROR: 1003,
	PERMISSION_DENIED: 1004,
	SESSION_NOT_ACTIVE: 1005,
	CONFLICT: 1006,
	RATE_LIMITED: 1007,

	// Hook errors
	HOOK_NOT_FOUND: 1100,
	HOOK_VALIDATION_ERROR: 1101,
	HOOK_EXECUTION_ERROR: 1102,
	HOOK_TIMEOUT: 1103,
	HOOK_INSTALL_ERROR: 1104,
	HOOK_SCRIPT_ERROR: 1105,
	HOOK_BUILTIN_READONLY: 1106,
	CLAUDE_SETTINGS_ERROR: 1107,
} as const;


export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// =============================================================================
// Core Configuration
// =============================================================================

/**
 * Core process configuration
 */
export interface CoreConfig {
	/** HTTP server port */
	httpPort: number;
	/** WebSocket server port */
	wsPort: number;
	/** Log retention in days */
	logRetentionDays: number;
	/** Maximum logs to keep in memory */
	maxLogsInMemory: number;
}


/**
 * Core initialization parameters
 */
export interface CoreInitParams {
	workspaceRoot: string;
	storagePath: string;
	config: CoreConfig;
}


/**
 * Core status response
 */
export interface CoreStatus {
	status: "running" | "starting" | "stopping" | "error";
	uptime: number;
	httpPort: number;
	wsPort: number;
	stats: Stats;
	version: string;
}
