/**
 * @inspector-hook/core
 * Core business logic for Inspector Hook
 */

// Re-export protocol types for convenience
export * from "@inspector-hook/protocol";

// Export main core class
export { InspectorCore } from "./core.js";

// Export IPC server
export { IpcServer } from "./ipc/ipc-server.js";

// Export managers
export { FileTracker } from "./managers/file-tracker.js";
export { LogManager } from "./managers/log-manager.js";
export { SessionManager } from "./managers/session-manager.js";
export {
	deriveSessionName,
	extractProjectName,
	mergeSessionMetadata,
	type SessionMetadataInput,
} from "./managers/session-metadata.js";
export {
	createExecution,
	findAbandonedExecutions,
	findRunningExecution,
	isToolCompletionEvent,
	isToolStartEvent,
	markAbandoned,
	terminalStatusFor,
	TOOL_COMPLETION_EVENTS,
	TOOL_START_EVENTS,
} from "./managers/tool-executions.js";
export { DiffEngine } from "./managers/diff-engine.js";

// Export persistence
export { PersistenceStore } from "./persistence/store.js";
export {
	migrateStore,
	CURRENT_SCHEMA_VERSION,
	type MigrationResult,
} from "./persistence/migrations.js";

// Export HTTP server
export { HttpServer } from "./server/http-server.js";

// Export version
export const VERSION = "0.1.0";
