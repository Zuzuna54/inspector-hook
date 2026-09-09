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
	bundlePath,
	bundlesDir,
	deleteBundle,
	isSafeBundleId,
	listBundles,
	loadIntoTray,
	readBundle,
	saveBundle,
	type ContextBundle,
} from "./context/bundle-store.js";
export {
	composeFromTranscript,
	composeTitle,
	MAX_ENTRY_BYTES,
	type ComposeResult,
} from "./context/compose.js";
// Export the transcript reader (Milestone 3, P5)
export {
	readTranscript,
	transcriptStats,
	MAX_LINE_BYTES,
	MAX_TRANSCRIPT_BYTES,
	type TranscriptEntry,
	type TranscriptKind,
	type TranscriptPage,
	type TranscriptStats,
	type TranscriptUsage,
} from "./transcript/transcript-reader.js";
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
export { listProjects } from "./projects/project-registry.js";
export type { ProjectSources } from "./projects/project-registry.js";
export {
	buildProjects,
	findProject,
	matches,
	slugForPath,
	total,
} from "./projects/project-identity.js";
export type {
	ProjectCandidate,
	ProjectCounts,
	ProjectIdentity,
	ProjectMatch,
	ProjectObservation,
} from "./projects/project-identity.js";
export {
	INJECTIONS_FILE,
	injectionCounts,
	injectionsPath,
	MAX_INJECTIONS_BYTES,
	readInjections,
	recordInjection,
} from "./context/injections.js";
export type {
	InjectionReadResult,
	InjectionRecord,
	InjectionTier,
} from "./context/injections.js";
export { ContextIndex, findResult } from "./context/context-index.js";
export {
	CHANGE_SCAN_LIMIT,
	ContextFindService,
	LOG_SCAN_LIMIT,
	STALE_AFTER_MS,
} from "./context/find-service.js";
export type { FindOptions, FindSources } from "./context/find-service.js";
export type { ContextSearchOptions } from "./context/context-index.js";
export {
	changedLines,
	digestDoc,
	fileChangeDoc,
	LOCAL_CORPORA,
	logDoc,
	memoryDoc,
	snippetOf,
	summaryDoc,
} from "./context/context-corpus.js";


export {
	collectDigestInput,
	type ChangeSource,
	type CollectOptions,
	type LogSource,
} from "./memory/digest-input.js";

// Export the MCP server (Milestone 5)
export {
	MAX_RESULT_CHARS,
	PROTOCOL_VERSION,
	SERVER_NAME,
	TOOLS,
	callTool,
	startMcpServer,
	type McpTool,
} from "./mcp/mcp-server.js";

export {
	DEFAULT_MAX_CHARS,
	MIN_SCORE,
	PER_SECTION,
	buildBriefing,
	type Briefing,
	type BriefingSection,
} from "./research/briefing.js";

// Export code quality analysis (Milestone 7)
export {
	ANALYZERS,
	DETECT_DEPTH,
	LANGUAGE_FLOOR,
	VENDOR_DIRS,
	analyzersFor,
	detectLanguages,
	estimateSeconds,
	findJsRoot,
	hasManifest,
	type Analyzer,
	type AnalyzerContext,
	type FindingKind,
	type LanguageCounts,
	type ParsedFinding,
} from "./quality/analyzers.js";

export {
	MAX_HISTORY,
	QUALITY_CATEGORY,
	QualityStore,
	projectStoreId,
} from "./quality/quality-store.js";

export {
	MAX_OUTPUT_BYTES,
	TOOL_TIMEOUT_MS,
	hasGraph,
	packageName,
	parseKnipFiles,
	parseMadgeCycles,
	parseSonarSecrets,
	scanProject,
	type ScanOptions,
} from "./quality/scanner.js";

export {
	groundTruthsFor,
	rankFindings,
	toRelative,
	webviewManifestTruth,
	type Confidence,
	type DeadCodeFinding,
	type GroundTruth,
	type SignalInput,
	type SignalName,
} from "./quality/confidence.js";

export {
	CWD_PROBE_BYTES,
	TRANSCRIPT_ROOT,
	cwdFromTranscript,
	discoverProjects,
	pathFromDashedName,
	summarise,
	type ProjectTools,
	type RegistrySummary,
	type ScannableProject,
} from "./quality/project-registry.js";

export {
	GOD_NODE_FLOOR,
	GOD_NODE_PERCENTILE,
	TOP_N,
	analyseGraph,
	type CouplingReport,
	type GodNode,
	type GraphAnalysis,
	type OrphanNode,
	type RotReport,
} from "./quality/graph-analysis.js";

// Export agent tracking (Milestone 5)
export {
	AgentTracker,
	MAX_AGENTS,
	MAX_TEXT,
	MAX_TOOL_CALLS,
	classifyResult,
	typeFromAgentId,
	type AgentTrackerOptions,
} from "./managers/agent-tracker.js";

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
// Export the graphify code/docs graph (Milestone 4). Separate from the
// research index by design: graphify owns code and docs, the research index
// owns session history. See research/graphify.ts.
export {
	GRAPH_DIR,
	GRAPH_FILE,
	GraphifyGraph,
	GraphifyReader,
	MAX_GRAPH_BYTES,
	buildGraph,
	findGraphPath,
	headCommit,
	identifierText,
	type GraphifyEdge,
	type GraphifyNeighbor,
	type GraphifyNode,
	type GraphifySearchHit,
	type GraphifySearchResult,
	type GraphifyStats,
} from "./research/graphify.js";
export {
	DEFAULT_MODEL,
	EMBEDDING_DIMENSIONS,
	EMBED_BATCH,
	MAX_EMBED_CHARS,
	RRF_K,
	VectorStore,
	cosine,
	loadEmbedder,
	reciprocalRankFusion,
	type Embedder,
	type FusedHit,
	type VectorHit,
} from "./research/embeddings.js";
export {
	EXPANSIONS_PER_TERM,
	EXPANSION_WEIGHT,
	SemanticExpander,
	type Association,
} from "./research/semantic.js";

export {
	clearProjectCache,
	resolveProject,
	type ProjectInfo,
} from "./managers/project-resolver.js";

// Export version
export const VERSION = "0.1.0";
