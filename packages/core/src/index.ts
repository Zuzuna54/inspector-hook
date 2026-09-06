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
	DEFAULT_TTL_MS,
	MAX_CONTEXT_BYTES,
	STAGED_CONTEXT_FILE,
	clearStagedContext,
	readStagedContext,
	stageContext,
	stagedContextPath,
	type StagedContext,
} from "./memory/staged-context.js";
export {
	buildSessionDigest,
	formatDuration,
	type DigestInput,
	type SessionDigest,
} from "./memory/session-digest.js";
// Export the context tray (Milestone 3, P3)
export {
	addItem,
	clearTray,
	effectiveText,
	emptyTray,
	isEdited,
	readTray,
	removeItem,
	reorderItems,
	resetItem,
	trayPath,
	updateItem,
	writeTray,
} from "./context/tray-store.js";
export { includedCount, renderTray } from "./context/render.js";
export {
	armContext,
	disarmContext,
	estimatedRepeatBytes,
	isSafeSessionId,
	listArmed,
	readAllArmed,
	readArmed,
	resolveTtl,
	armedPath,
	DEFAULT_NOW_TTL_MS,
	DEFAULT_PIN_TTL_MS,
	MAX_PIN_TTL_MS,
	type ArmedContext,
	type ArmedTier,
} from "./context/armed-store.js";

export {
	collectDigestInput,
	type ChangeSource,
	type CollectOptions,
	type LogSource,
} from "./memory/digest-input.js";

// Export research history + search (Milestone 4)
export {
	B,
	Bm25Index,
	K1,
	tokenize,
	type Bm25Snapshot,
} from "./research/bm25.js";
export {
	MAX_ITEM_TEXT,
	RESEARCH_KINDS,
	extractResearchItem,
	projectKeyFor,
} from "./research/extract.js";
export {
	DEFAULT_MAX_ITEMS,
	ResearchIndex,
	SNIPPET_LENGTH,
	type ResearchIndexOptions,
} from "./research/research-index.js";

export {
	clearProjectCache,
	resolveProject,
	type ProjectInfo,
} from "./managers/project-resolver.js";

// Export version
export const VERSION = "0.1.0";
