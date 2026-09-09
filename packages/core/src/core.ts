/**
 * Main Inspector Hook Core class
 * Orchestrates all components with persistence and event handling
 */

import type {
	CoreConfig,
	CoreInitParams,
	CoreStatus,
	Session,
	SessionSummaryRecord,
	Stats,
} from "@inspector-hook/protocol";
import {
	CHANGE_SCAN_LIMIT,
	ContextFindService,
	LOG_SCAN_LIMIT,
} from "./context/find-service.js";
import { listProjects } from "./projects/project-registry.js";
import type { ProjectIdentity } from "./projects/project-identity.js";
import { VERSION } from "./index.js";
import { IpcServer } from "./ipc/ipc-server.js";
import { AgentTracker } from "./managers/agent-tracker.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { QualityStore } from "./quality/quality-store.js";
import {
	discoverProjects,
	summarise,
	type ScannableProject,
} from "./quality/project-registry.js";
import { scanProject, type ScanOptions } from "./quality/scanner.js";
import {
	archiveSkill,
	listArchivedSkills,
	restoreSkill,
	type ArchiveResult,
} from "./skills/skill-archive.js";
import {
	discoverSkills,
	MAX_SKILL_BYTES,
} from "./skills/skill-registry.js";
import {
	probeMcpServers,
	type ProbeResult,
} from "./skills/mcp-probe.js";
import { readConfiguredServers } from "./skills/utilization.js";
import {
	buildSkillsOverview,
	type OverviewOptions,
} from "./skills/skills-overview.js";
import { FileTracker } from "./managers/file-tracker.js";
import { LogManager } from "./managers/log-manager.js";
import { SessionManager } from "./managers/session-manager.js";
import { collectDigestInput } from "./memory/digest-input.js";
import {
	listMemoryProjects,
	resolveMemoryDir,
	writeMemoryFile,
} from "./memory/native-memory.js";
import { buildSessionDigest } from "./memory/session-digest.js";
import { migrateStore } from "./persistence/migrations.js";
import { PersistenceStore } from "./persistence/store.js";
import { type Briefing, buildBriefing } from "./research/briefing.js";
import { GraphifyReader } from "./research/graphify.js";
import { ResearchIndex } from "./research/research-index.js";
import { HttpServer } from "./server/http-server.js";

/**
 * How long a skills/MCP utilization count is reused.
 *
 * The scan reads every transcript, so it is not free; the corpus also changes
 * only as fast as you work. Two minutes keeps a tab switch instant without
 * showing a number from an hour ago.
 */
const SKILLS_CACHE_MS = 2 * 60 * 1000;

export class InspectorCore {
	private httpServer: HttpServer;
	private ipcServer: IpcServer;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;
	private persistence: PersistenceStore;
	private researchIndex: ResearchIndex;
	private contextFind: ContextFindService;
	private readonly workspaceRoot: string;
	/**
	 * One graph reader per repository.
	 *
	 * The core is machine-wide and graphify graphs are per-repo, so a single
	 * reader would serve one project's graph to every project. Bounded because
	 * this is keyed on a path that arrives from outside.
	 */
	private readonly graphifyReaders = new Map<string, GraphifyReader>();
	/**
	 * Agent and subagent tracking (M5).
	 *
	 * Fed from the same log stream as everything else rather than from its own
	 * hook path: `agentId` rides on ordinary tool events -- 3757 of 9014 in the
	 * live store -- so what an agent DID is already in the stream and needs no
	 * new transport.
	 */
	private readonly agentTracker = new AgentTracker();
	/**
	 * Quality reports for every observed project (M7).
	 *
	 * Machine-wide, like the research index: Inspector Hook scans the projects
	 * it watches, not its own repository.
	 */
	private readonly qualityStore: QualityStore;
	/**
	 * The last probe of each MCP server.
	 *
	 * Kept in memory rather than persisted: reachability is a fact about right
	 * now, and a stored "reachable" that survives a restart would be a claim
	 * nobody checked. `checkedAt` on each result lets a view age it.
	 */
	private readonly mcpProbes = new Map<string, ProbeResult>();
	private skillsCache?: {
		at: number;
		overview: Awaited<ReturnType<typeof buildSkillsOverview>>;
	};

	/**
	 * Periodic index flush.
	 *
	 * Without it the index is written only on a clean shutdown, so a crash or a
	 * kill loses everything indexed since start — and the index is the thing
	 * that is supposed to outlive the logs. unref'd so it cannot hold the
	 * process open, which is the leaked-timer bug this branch already fixed once.
	 */
	private researchFlushInterval?: NodeJS.Timeout;

	private startTime: number = 0;
	private status: CoreStatus["status"] = "starting";
	private config: CoreConfig;
	private storagePath: string;

	constructor(params: CoreInitParams) {
		this.config = params.config;
		this.storagePath = params.storagePath;

		// Initialize persistence store
		this.persistence = new PersistenceStore({
			basePath: params.storagePath,
			maxLogFileSize: 10 * 1024 * 1024, // 10MB
			maxLogFiles: 10,
		});

		// Initialize managers with persistence support
		this.logManager = new LogManager({
			storagePath: params.storagePath,
			maxLogsInMemory: params.config.maxLogsInMemory,
			retentionDays: params.config.logRetentionDays,
			persistence: this.persistence,
			// Retention must preserve before it prunes. Bound as a method so the
			// managers it needs are the ones on this instance.
			collapseSession: (id, session) => this.collapseSession(id, session),
		});

		this.sessionManager = new SessionManager({
			storagePath: params.storagePath,
			persistence: this.persistence,
		});

		this.fileTracker = new FileTracker({
			workspaceRoot: params.workspaceRoot,
			storagePath: params.storagePath,
			persistence: this.persistence,
		});

		// Research history index (M4). Built as events arrive and persisted
		// separately from the logs, because retention deletes those and the
		// index has to outlive them.
		this.researchIndex = new ResearchIndex({
			persistence: this.persistence,
			workspaceRoot: params.workspaceRoot,
		});

		// Cross-corpus search (M3 P8). Reads its sources rather than being fed
		// by them, so no mutation path in the core has to remember to notify it
		// -- the failure mode of forgetting one is a search that answers from
		// stale material and looks identical to one that found nothing.
		this.contextFind = new ContextFindService({
			memoryProjects: () => listMemoryProjects(),
			sessions: async () =>
				(await this.sessionManager.getSessions({})).sessions,
			digestFor: async (session) =>
				buildSessionDigest(
					await collectDigestInput({
						session,
						logs: this.logManager,
						changes: this.fileTracker,
					}),
				),
			summaries: async () =>
				[
					...(await this.persistence.loadAllJSON("summaries")).values(),
				] as never,
			// Pending AND archived.
			//
			// `getAllChanges` reads only the pending map; keeping or reverting a
			// change moves it to `archived`. On this machine that is 0 pending
			// against 240 archived, so indexing only the former produced an
			// empty corpus that looked like a working search finding nothing.
			//
			// Both limits are passed explicitly because both default to 100 --
			// without them CHANGE_SCAN_LIMIT would be a number the code states
			// and does not honour.
			changes: async () => {
				const [pending, archived] = await Promise.all([
					this.fileTracker.getAllChanges({
						pagination: { offset: 0, limit: CHANGE_SCAN_LIMIT },
					}),
					this.fileTracker.getArchivedChanges({ limit: CHANGE_SCAN_LIMIT }),
				]);
				return [
					...pending.changes,
					...archived.changes.map((change) => ({
						id: change.id,
						filePath: change.filePath,
						sessionId: change.sessionId,
						timestamp: change.originalTimestamp,
						beforeContent: change.beforeContent,
						afterContent: change.afterContent,
						status: "kept" as const,
					})),
				];
			},
			research: () => this.researchIndex,
			projects: () => this.listProjects(),
			// Events, so the header search stops being logs-only in one
			// direction and log-blind in the other: one query, every corpus.
			logs: async () =>
				(await this.logManager.getLogs({
					pagination: { offset: 0, limit: LOG_SCAN_LIMIT },
				})).logs,
			// Retention is off by choice, so the store grows without bound and
			// nothing else in the UI reports what that costs. `getStats()` has
			// computed it since it was written and had no consumer until here.
			storeStats: () => this.persistence.getStats(),
		});

		this.workspaceRoot = params.workspaceRoot;
		this.qualityStore = new QualityStore(this.persistence);

		// Initialize servers
		this.httpServer = new HttpServer({
			port: params.config.httpPort,
			logManager: this.logManager,
			sessionManager: this.sessionManager,
			fileTracker: this.fileTracker,
			// The subagent briefing hook reaches the core over HTTP.
			getBriefing: (options) => this.getBriefing(options),
		});

		this.ipcServer = new IpcServer({
			logManager: this.logManager,
			sessionManager: this.sessionManager,
			fileTracker: this.fileTracker,
			core: this,
			storagePath: params.storagePath,
		});

		// Wire up events for cross-manager communication
		this.setupEventHandlers();
	}

	/**
	 * Set up event handlers for cross-manager communication
	 */
	private setupEventHandlers(): void {
		// When a new log is added, broadcast to VS Code for live updates
		this.logManager.on("log:added", (log) => {
			this.ipcServer.sendNotification("log", log);
		});

		// Index anything research-shaped as it arrives. Most entries yield
		// nothing, which is the normal case; the call is a cheap field check.
		this.logManager.on("log:added", (log) => {
			this.agentTracker.ingest(log);
		});

		this.logManager.on("log:added", (log) => {
			this.researchIndex.ingest(log);
		});

		// Broadcast stats updates periodically (every new log triggers stats update)
		this.logManager.on("log:added", () => {
			this.ipcServer.sendNotification("stats", this.getStats());
		});

		// When a session is created, broadcast to VS Code
		// Note: We don't log session.start here - the SessionStart hook already does that
		this.sessionManager.on("session:created", (session) => {
			this.ipcServer.sendNotification("session", session);
		});

		// When a session ends, log it and broadcast
		this.sessionManager.on("session:ended", (session) => {
			this.logManager.addLog({
				hook: "SessionManager",
				timestamp: new Date().toISOString(),
				level: "info",
				message: `Session ended: ${session.id}`,
				sessionId: session.id,
				event: "session.end",
			});
			// Broadcast session event to VS Code
			this.ipcServer.sendNotification("session", session);

			// Milestone 3: record what happened into Claude Code's own memory,
			// so the next session in this project loads it with no injection
			// hook of ours involved. Off unless explicitly enabled.
			void this.writeSessionMemory(session);
		});

		// When a session goes idle, log it and broadcast
		this.sessionManager.on("session:idle", (session) => {
			this.logManager.addLog({
				hook: "SessionManager",
				timestamp: new Date().toISOString(),
				level: "info",
				message: `Session went idle: ${session.id}`,
				sessionId: session.id,
				event: "session.idle",
			});
			// Broadcast session event to VS Code for real-time status update
			this.ipcServer.sendNotification("session", session);
		});

		// When a session is terminated, log it and broadcast
		this.sessionManager.on("session:terminated", (session) => {
			this.logManager.addLog({
				hook: "SessionManager",
				timestamp: new Date().toISOString(),
				level: "info",
				message: `Session terminated: ${session.id}`,
				sessionId: session.id,
				event: "session.terminated",
			});
			// Broadcast session event to VS Code
			this.ipcServer.sendNotification("session", session);
		});

		// Tool lifecycle -> the session broadcast.
		//
		// These five events had SIX emit sites, ZERO listeners and ZERO tests:
		// a working-looking event bus that reached nothing. `session:*` next door
		// all forward to IPC; `tool:*` forwarded nowhere, so a tool starting or
		// finishing produced no update and the webview only learned by asking.
		//
		// Re-broadcasting the session is the honest mapping rather than a new
		// message type: a tool call beginning or ending genuinely changes the
		// session, `session` is already a handled notification, and M5's agent
		// tree can carry a richer payload when it has a consumer to build
		// against. Deleting them instead would have thrown away the one signal
		// M5 needs.
		for (const event of [
			"tool:started",
			"tool:completed",
			"tool:failed",
			"tool:blocked",
			"tool:unknown",
		] as const) {
			this.sessionManager.on(event, ({ sessionId }) => {
				// Resident, not awaited: getSession returns a Promise, and the
				// first version of this broadcast a Promise as the payload.
				const session = this.sessionManager.getResidentSession(sessionId);
				if (session) this.ipcServer.sendNotification("session", session);
			});
		}

		// NOTE: file capture/tracking is deliberately NOT wired to the
		// "tool:started"/"tool:completed" session events. HttpServer.handleLogPost
		// already drives captureBeforeContent on PreToolUse and trackFromLog on
		// PostToolUse. Doing it here as well raced that path: trackActivity emits
		// these events synchronously, the async handler yielded at its first await,
		// and both readers saw the same entry in the shared pendingCaptures map
		// before either deleted it -- producing two FileChange records per edit.
		// The HTTP ingest path is the single source of truth for file tracking.

		// When a file change is tracked, broadcast via IPC
		this.fileTracker.on("change:tracked", (change) => {
			// Use "fileChange" method which core-bridge expects
			this.ipcServer.sendNotification("fileChange", change);
		});

		// When a change is kept, broadcast
		this.fileTracker.on("change:kept", (change) => {
			this.ipcServer.sendNotification("fileChange", {
				...change,
				eventType: "kept",
			});
		});

		// When a change is reverted, broadcast
		this.fileTracker.on("change:reverted", (change) => {
			this.ipcServer.sendNotification("fileChange", {
				...change,
				eventType: "reverted",
			});
		});

		// When a version is created, broadcast
		this.fileTracker.on("version:created", ({ filePath, version }) => {
			this.ipcServer.sendNotification("fileChange", {
				eventType: "version:created",
				filePath,
				versionNumber: version.versionNumber,
			});
		});
	}

	/**
	 * Start the core process
	 */
	/**
	 * Start the core.
	 *
	 * `ipc: false` loads everything but leaves stdio alone, for the MCP server
	 * (M5) which speaks a different protocol on the same stream. Both reading
	 * stdin would mean two readers racing for every line.
	 */
	async start(options?: { ipc?: boolean }): Promise<void> {
		this.startTime = Date.now();
		this.status = "starting";

		try {
			// Initialize persistence first
			await this.persistence.initialize();

			// Repair any records left by previously-fixed bugs before the managers
			// read them into memory.
			const migration = await migrateStore(this.storagePath);
			if (migration.applied.length > 0) {
				process.stderr.write(
					`[Migration] ${migration.fromVersion} -> ${migration.toVersion}: ${
						migration.notes.join("; ") || "no changes needed"
					}\n`,
				);
			}

			// Load persisted data
			await this.sessionManager.load();
			await this.fileTracker.load();
			await this.logManager.load();

			// Restore the research index, and adopt an existing store on first
			// run: everything captured before the index existed is still in the
			// log, and re-reading it once beats telling a user their history
			// starts today.
			// Read once, use twice. Both the research index and the agent tracker
			// want the whole log on a cold start, and this is a 100k-row read.
			let cachedLogs:
				| Awaited<ReturnType<typeof this.logManager.getLogs>>["logs"]
				| null = null;
			const allLogs = async () => {
				if (!cachedLogs) {
					const { logs } = await this.logManager.getLogs({
						pagination: { limit: 100_000, offset: 0 },
					});
					cachedLogs = logs;
				}
				return cachedLogs;
			};

			const restored = await this.researchIndex.load();
			if (restored.items === 0) {
				const logs = await allLogs();
				const built = this.researchIndex.backfill(logs);
				if (built.indexed > 0) {
					process.stderr.write(
						`[Research] indexed ${built.indexed} items from ${built.scanned} existing logs\n`,
					);
					await this.researchIndex.flush();
				}
			} else if (restored.rebuilt) {
				process.stderr.write(
					`[Research] index was inconsistent with its items; rebuilt ${restored.items}\n`,
				);
				await this.researchIndex.flush();
			}

			// Rebuild the agent tree from the log.
			//
			// Nothing about agents is persisted -- the tree is a projection of
			// events that are already stored -- so without this the view is
			// empty until the next subagent runs, which is the "built but shows
			// nothing" failure this project keeps finding. Backfilling 13593
			// live events yields 199 agents and 1904 attributed tool calls.
			const agentLogs = await allLogs();
			const agentsBuilt = this.agentTracker.backfill(agentLogs);
			if (agentsBuilt.agents > 0) {
				process.stderr.write(
					`[Agents] rebuilt ${agentsBuilt.agents} agents from ${agentsBuilt.scanned} logs\n`,
				);
			}

			// Start HTTP server for hook ingestion
			await this.httpServer.start();

			// Start IPC server for wrapper communication
			if (options?.ipc !== false) {
				await this.ipcServer.start();
			}

			this.researchFlushInterval = setInterval(
				() => {
					void this.researchIndex.flush().catch(() => {});
				},
				5 * 60 * 1000,
			);
			this.researchFlushInterval.unref?.();

			this.status = "running";
		} catch (error) {
			this.status = "error";
			throw error;
		}
	}

	/**
	 * Stop the core process
	 */
	async stop(): Promise<void> {
		this.status = "stopping";

		try {
			await this.httpServer.stop();
			await this.ipcServer.stop();

			// Release the managers' housekeeping timers. Without this the process
			// stays alive after a shutdown request, because both intervals were
			// created and never cleared.
			this.sessionManager.stopStaleSessionCheck();
			this.logManager.destroy();
			if (this.researchFlushInterval) {
				clearInterval(this.researchFlushInterval);
				this.researchFlushInterval = undefined;
			}

			// Persist any pending data
			await this.researchIndex.flush();
			await this.logManager.flush();
			await this.sessionManager.flush();
			await this.fileTracker.flush();

			this.status = "running"; // Process will exit after this
		} catch (error) {
			this.status = "error";
			throw error;
		}
	}

	/**
	 * Get actual HTTP port (may differ from config if port 0 was used)
	 */
	getHttpPort(): number {
		return this.httpServer.getPort();
	}

	/**
	 * Get current status
	 */
	getStatus(): CoreStatus {
		return {
			status: this.status,
			uptime:
				this.startTime > 0
					? Math.floor((Date.now() - this.startTime) / 1000)
					: 0,
			httpPort: this.httpServer.getPort(),
			stats: this.getStats(),
			version: VERSION,
			writeSessionMemory: this.config.writeSessionMemory === true,
		};
	}

	/**
	 * Get current statistics
	 */
	getStats(): Stats {
		const logStats = this.logManager.getStats();
		const sessionStats = this.sessionManager.getStats();
		const fileStats = this.fileTracker.getStats();

		return {
			totalLogs: logStats.totalLogs,
			errors: logStats.errors,
			warnings: logStats.warnings,
			blocked: logStats.blocked,
			logsPerMinute: logStats.logsPerMinute,
			activeSessions: sessionStats.activeSessions,
			pendingChanges: fileStats.pendingChanges,
		};
	}

	/**
	 * Collapse an expiring session into a durable summary.
	 *
	 * Retention shipped as the destructive half of a two-part design: the plan
	 * pairs dropping raw rows with collapsing to session summaries first, and
	 * only the dropping existed. So ageing out deleted the only record of a
	 * session, and any memory digest citing it became unresolvable — which the
	 * corpus already shows happening for Claude Code's own memory, where 0 of
	 * 11 cited sessions still exist anywhere.
	 *
	 * The summary is the same digest the memory path uses, stored in the store
	 * rather than in the user's memory corpus: this is Inspector Hook's own
	 * record, written without asking, so it does not belong in files that shape
	 * what future Claude sessions are told.
	 *
	 * Returns false on failure, which cancels that session's deletion. A
	 * session we could not preserve is worth more on disk than freed.
	 */
	/**
	 * Everything a digest is built from, for either path here.
	 *
	 * Both callers used to pass a bare session, which silently produced a
	 * thinner digest than the one the panel showed for the same session. One
	 * collector means there is no longer a "which path built this" question to
	 * get wrong.
	 */
	private async digestInputFor(session: Session) {
		return collectDigestInput({
			session,
			logs: this.logManager,
			changes: this.fileTracker,
		});
	}

	private async collapseSession(
		id: string,
		session: unknown,
	): Promise<boolean> {
		try {
			const record = session as Session | undefined;
			if (!record || typeof record !== "object") return false;

			// The full input, not a bare session. This is the retention path: its
			// whole purpose is to preserve value before the raw data is deleted,
			// so it must not write the weakest of the three digests. It used to
			// -- the summary that survives permanently said "N changes (paths
			// unresolved)" and carried no counts, while the preview you can
			// regenerate any time got the good one. Exactly backwards.
			const digest = buildSessionDigest(await this.digestInputFor(record));
			const summary: SessionSummaryRecord = {
				id,
				collapsedAt: new Date().toISOString(),
				startTime: record.startTime,
				endTime: record.endTime,
				status: record.status,
				name: record.name,
				metadata: record.metadata,
				toolExecutionCount: Array.isArray(record.toolExecutions)
					? record.toolExecutions.length
					: 0,
				fileChangeCount: Array.isArray(record.fileChanges)
					? record.fileChanges.length
					: 0,
				// Even a session judged not worth a MEMORY entry gets a summary
				// here: the bar for "keep a record" is far lower than the bar for
				// "tell a future Claude about it".
				description: digest.description,
				digest: digest.worthKeeping ? digest.body : undefined,
			};

			await this.persistence.saveJSON("summaries", id, summary);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Write a session digest into native auto memory.
	 *
	 * Never throws into the event emitter: a failure here must not take down
	 * session bookkeeping, and it must not fail silently either -- every
	 * outcome, including a refusal, is logged with its reason. This is the part
	 * of the system most able to make a false claim ("saved to memory" when
	 * nothing was written), so it reports what actually happened.
	 */
	private async writeSessionMemory(session: Session): Promise<void> {
		if (!this.config.writeSessionMemory) return;

		try {
			const digest = buildSessionDigest(await this.digestInputFor(session));
			if (!digest.worthKeeping) {
				this.logManager.addLog({
					hook: "SessionMemory",
					timestamp: new Date().toISOString(),
					level: "info",
					message: `No memory written for ${session.id}: ${digest.skipReason}`,
					sessionId: session.id,
					event: "memory.skipped",
				});
				return;
			}

			const memoryDir = resolveMemoryDir(session.metadata?.transcriptPath);
			const result = await writeMemoryFile(memoryDir, digest);

			this.logManager.addLog({
				hook: "SessionMemory",
				timestamp: new Date().toISOString(),
				level: result.written ? "info" : "warn",
				message: result.written
					? `Wrote session memory to ${result.path}`
					: `Session memory not written: ${result.reason ?? result.refused}`,
				sessionId: session.id,
				event: result.written ? "memory.written" : "memory.refused",
			});
		} catch (error) {
			this.logManager.addLog({
				hook: "SessionMemory",
				timestamp: new Date().toISOString(),
				level: "error",
				message: `Session memory failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				sessionId: session.id,
				event: "memory.error",
			});
		}
	}

	/**
	 * Get log manager instance
	 */
	getLogManager(): LogManager {
		return this.logManager;
	}

	/**
	 * Get session manager instance
	 */
	getSessionManager(): SessionManager {
		return this.sessionManager;
	}

	/**
	 * Get file tracker instance
	 */
	getFileTracker(): FileTracker {
		return this.fileTracker;
	}

	/**
	 * Get the research index
	 */
	getResearchIndex(): ResearchIndex {
		return this.researchIndex;
	}

	/**
	 * Get the graphify reader for a repository.
	 *
	 * `root` may name any repository this core has seen, defaulting to the
	 * workspace. It is only ever used to open `<root>/graphify-out/graph.json`
	 * -- one fixed filename under one fixed directory -- and a relative path is
	 * refused rather than resolved against whatever the cwd happens to be.
	 */
	/**
	 * Every project this core can see, reconciled across three identity spaces.
	 *
	 * Not cached: it is cheap, and a stale list would offer a project that no
	 * longer has anything behind it — a filter that scopes a view to nothing
	 * and looks like an empty store.
	 */
	async listProjects(): Promise<ProjectIdentity[]> {
		return listProjects({
			sessions: async () => (await this.sessionManager.getSessions({})).sessions,
			memoryProjects: () => listMemoryProjects(),
			changes: async () => {
				const [pending, archived] = await Promise.all([
					this.fileTracker.getAllChanges({
						pagination: { offset: 0, limit: CHANGE_SCAN_LIMIT },
					}),
					this.fileTracker.getArchivedChanges({ limit: CHANGE_SCAN_LIMIT }),
				]);
				return [
					...pending.changes,
					...archived.changes.map((c) => ({
						id: c.id,
						filePath: c.filePath,
						sessionId: c.sessionId,
						timestamp: c.originalTimestamp,
						beforeContent: c.beforeContent,
						afterContent: c.afterContent,
						status: "kept" as const,
					})),
				];
			},
			research: () => this.researchIndex,
			workspaceRoot: this.workspaceRoot,
		});
	}

	/** Cross-corpus search over memory, digests, file changes and prompts. */
	getContextFind(): ContextFindService {
		return this.contextFind;
	}

	/**
	 * A briefing on prior work for a task that is about to start (M5).
	 *
	 * Lives here rather than in the briefing module because it is the only
	 * place that holds all three sources at once -- the research index, the
	 * agent tracker and the graph reader.
	 */
	async getBriefing(options?: {
		task?: string;
		projectKey?: string;
		maxChars?: number;
		root?: string;
	}): Promise<Briefing> {
		return buildBriefing({
			index: this.researchIndex,
			tracker: this.agentTracker,
			graphify: this.getGraphify(options?.root),
			task: options?.task,
			// Default to this core's own project: a briefing drawn from every
			// project on the machine would cite another repository's work as
			// prior art for this one.
			projectKey:
				options?.projectKey ?? this.researchIndex.stats().defaultProjectKey,
			maxChars: options?.maxChars,
		});
	}

	/** Every project Inspector Hook could scan, existing or not (M7). */
	listScannableProjects(): {
		projects: ScannableProject[];
		summary: ReturnType<typeof summarise>;
	} {
		const projects = discoverProjects();
		return { projects, summary: summarise(projects) };
	}

	/**
	 * Scan one project and store the result.
	 *
	 * Stores even a report where every tool failed: "nothing could be measured"
	 * is the finding in that case, and discarding it would leave the history
	 * looking like the scan never happened.
	 */
	async scanProjectQuality(root: string, options?: ScanOptions) {
		const project =
			discoverProjects().find((p) => p.root === root) ??
			// A project the transcripts have not seen is still scannable when a
			// caller names it directly.
			({
				root,
				name: root.split("/").filter(Boolean).pop() ?? root,
				transcriptDir: "",
				exists: existsSync(root),
				hasGit: existsSync(join(root, ".git")),
				hasPackageJson: existsSync(join(root, "package.json")),
				hasTsconfig: existsSync(join(root, "tsconfig.json")),
				hasGraph: existsSync(join(root, "graphify-out", "graph.json")),
				tools: {
					knip: existsSync(join(root, "package.json")),
					madge: existsSync(join(root, "package.json")),
					graphify: existsSync(root),
					sonarSecrets: existsSync(root),
				},
				rootSource: "transcript" as const,
			} satisfies ScannableProject);

		const report = await scanProject(project, options);
		await this.qualityStore.save(report);
		return report;
	}

	/** The quality store (M7). */
	getQualityStore(): QualityStore {
		return this.qualityStore;
	}

	/**
	 * Skills and MCP tools: what is installed against what actually fires (M8).
	 *
	 * Cached, because the scan streams the whole transcript corpus — 121 files
	 * in ~1.7s on this machine — and the panel would otherwise pay that on
	 * every tab switch. Pass `refresh` to recount; the cache carries the
	 * measurement time so a caller can show how old the number is.
	 */
	async getSkillsOverview(options?: OverviewOptions & { refresh?: boolean }) {
		const now = Date.now();
		if (
			!options?.refresh &&
			this.skillsCache &&
			now - this.skillsCache.at < SKILLS_CACHE_MS
		) {
			return this.skillsCache.overview;
		}
		const overview = await buildSkillsOverview(options);
		this.skillsCache = { at: now, overview };
		return overview;
	}

	/**
	 * Archive an installed skill, or put one back (M8).
	 *
	 * The only write M8 performs, and it happens only when a caller asks. The
	 * overview above never touches `~/.claude`, which is what makes the
	 * "nothing was modified" check a property of the read path.
	 */
	async setSkillArchived(id: string, archived: boolean): Promise<ArchiveResult> {
		const storeRoot = this.persistence.getBasePath();
		const result = archived
			? await archiveSkill(id, { storeRoot })
			: await restoreSkill(id, { storeRoot });
		// The inventory just changed on disk, so the cached count is now wrong.
		if (result.ok) this.skillsCache = undefined;
		return result;
	}

	/**
	 * One skill's SKILL.md, for the detail pane (M8).
	 *
	 * The path is resolved by looking the id up in the discovered set rather
	 * than by joining `SKILLS_ROOT` with the id. That is deliberate: it makes a
	 * traversal attempt fail as "unknown skill" instead of reading a file, and
	 * it is the only way a plugin or project skill's real location is known.
	 */
	async readSkillFile(id: string) {
		const record = discoverSkills().find((s) => s.id === id);
		if (!record) return { error: `unknown skill: ${id}` };
		if (!record.skillFile) {
			return {
				id,
				path: record.path,
				text: "",
				bytes: 0,
				truncated: false,
				error: "this skill has no SKILL.md",
			};
		}
		try {
			const raw = await readFile(record.skillFile, "utf-8");
			const text = raw.slice(0, MAX_SKILL_BYTES);
			return {
				id,
				path: record.skillFile,
				text,
				bytes: Buffer.byteLength(raw, "utf-8"),
				truncated: text.length < raw.length,
				subdirectories: record.subdirectories,
				extraFiles: record.extraFiles,
			};
		} catch (error) {
			return {
				error: `could not read ${record.skillFile}: ${(error as Error).message}`,
			};
		}
	}

	/**
	 * Handshake with each configured MCP server (M8).
	 *
	 * NEVER called by `getSkillsOverview`. This spawns real processes — one of
	 * them starts a browser, and two fetch a package on first run — so it
	 * happens only when a caller asks. The overview stays a pure read.
	 *
	 * `readConfiguredServers` drops `env` before this sees a target, so the
	 * probe inherits the ambient environment and a server needing a key fails
	 * its handshake. That failure is reported rather than worked around: this
	 * is a diagnostic, and a diagnostic that handles secrets to make itself
	 * succeed is a worse trade than one that says "it did not answer".
	 */
	async probeMcpServers(names?: string[]): Promise<ProbeResult[]> {
		const wanted = names && names.length > 0 ? new Set(names) : undefined;
		const targets = [...readConfiguredServers()]
			.filter(([name]) => !wanted || wanted.has(name))
			.map(([name, config]) => ({
				name,
				command: config.command,
				args: config.args,
			}));
		const results = await probeMcpServers(targets);
		for (const result of results) this.mcpProbes.set(result.server, result);
		return results;
	}

	/** The most recent probe of each server, if any has been run. */
	getMcpProbes(): ProbeResult[] {
		return [...this.mcpProbes.values()];
	}

	/** Skills currently archived, newest first. */
	async listArchivedSkills() {
		const entries = await listArchivedSkills({
			storeRoot: this.persistence.getBasePath(),
		});
		return entries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
	}

	/** Get the agent tracker (M5). */
	getAgentTracker(): AgentTracker {
		return this.agentTracker;
	}

	/** The workspace this core was started for. */
	getWorkspaceRoot(): string {
		return this.workspaceRoot;
	}

	getGraphify(root?: string): GraphifyReader {
		const key = root && root.startsWith("/") ? root : this.workspaceRoot;
		const existing = this.graphifyReaders.get(key);
		if (existing) return existing;
		// Each reader holds a parsed graph, so this cache is measured in
		// megabytes, not entries.
		if (this.graphifyReaders.size >= 8) this.graphifyReaders.clear();
		const reader = new GraphifyReader(key);
		this.graphifyReaders.set(key, reader);
		return reader;
	}

	/**
	 * Get persistence store instance
	 */
	getPersistence(): PersistenceStore {
		return this.persistence;
	}
}
