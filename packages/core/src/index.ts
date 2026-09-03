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
export {
	RateLimiter,
	type RateLimiterOptions,
	type RateLimitResult,
} from "./server/rate-limiter.js";
export {
	redactPayload,
	redactString,
	REDACTED,
	type RedactionOptions,
} from "./server/redaction.js";

// Export native-memory integration (Milestone 3)
export {
	AUTHORED_BY,
	INDEX_FILE,
	INDEX_LOAD_BYTES,
	INDEX_LOAD_LINES,
	deleteMemoryFile,
	formatMemoryFile,
	indexMemoryFile,
	listMemoryProjects,
	memoryFileName,
	parseIndexReferences,
	parseMemoryFile,
	projectsRoot,
	readMemoryProject,
	removeIndexEntry,
	resolveMemoryDir,
	upsertIndexEntry,
	writeMemoryFile,
	type MemoryFile,
	type MemoryProject,
	type MemoryType,
	type WriteRefusal,
	type WriteResult,
} from "./memory/native-memory.js";
export {
	buildSessionDigest,
	formatDuration,
	type DigestInput,
	type SessionDigest,
} from "./memory/session-digest.js";

// Export version
export const VERSION = "0.1.0";
