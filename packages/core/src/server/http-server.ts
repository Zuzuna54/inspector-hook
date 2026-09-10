/**
 * HTTP Server for hook log ingestion
 * Receives logs via POST /log (primary) or /api/log (alias) from hook scripts
 */

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { LogEntry } from "@inspector-hook/protocol";
import type { FileTracker } from "../managers/file-tracker.js";
import type { LogManager } from "../managers/log-manager.js";
import type { SessionManager } from "../managers/session-manager.js";
import { normaliseHookPayload } from "./hook-payload.js";
import { RateLimiter } from "./rate-limiter.js";
import { redactPayload } from "./redaction.js";

/** How many ports above the preferred one to try before giving up. */
const PORT_SCAN_RANGE = 20;

/**
 * Ingest rate limit. Generous relative to real hook traffic — a busy session
 * produces a few events per second — while still bounding a flood.
 */
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;

export interface HttpServerOptions {
	port: number;
	/** Redact credentials from payloads before storing. Default true. */
	redactSecrets?: boolean;
	logManager: LogManager;
	sessionManager: SessionManager;
	fileTracker: FileTracker;
	/**
	 * Supplies a prior-work briefing for the subagent hook (M5).
	 *
	 * A callback rather than the core itself: the core constructs this server,
	 * so holding a reference back would be circular. Optional, so the server
	 * stays constructible in tests without one.
	 */
	getBriefing?: (options: {
		task?: string;
		projectKey?: string;
		maxChars?: number;
	}) => Promise<{ text: string; cited: number; empty: boolean }>;
}

export class HttpServer {
	private server: Server | null = null;
	private requestedPort: number;
	private actualPort: number = 0;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;
	private rateLimiter: RateLimiter;
	private redactSecrets: boolean;
	/** Supplies the prior-work briefing, when a core provided one. */
	private getBriefingFn?: HttpServerOptions["getBriefing"];
	private pruneInterval: ReturnType<typeof setInterval> | null = null;

	constructor(options: HttpServerOptions) {
		this.requestedPort = options.port;
		this.redactSecrets = options.redactSecrets !== false;
		this.getBriefingFn = options.getBriefing;
		this.rateLimiter = new RateLimiter({
			limit: RATE_LIMIT,
			windowMs: RATE_WINDOW_MS,
		});
		this.logManager = options.logManager;
		this.sessionManager = options.sessionManager;
		this.fileTracker = options.fileTracker;
	}

	/**
	 * Start the HTTP server.
	 *
	 * Port 0 lets the OS assign any free port. A non-zero port is treated as a
	 * preference rather than a demand: if it is taken (a second window, a stale
	 * process), we scan upward for the next free one. Keeping the port stable in
	 * the common case matters because `"type": "http"` hooks are configured with
	 * a literal URL in settings.json, but refusing to start would be worse.
	 */
	async start(): Promise<void> {
		if (this.requestedPort === 0) {
			await this.listenOn(0);
			return;
		}

		let lastError: Error | undefined;
		for (
			let port = this.requestedPort;
			port <= this.requestedPort + PORT_SCAN_RANGE;
			port++
		) {
			try {
				await this.listenOn(port);
				return;
			} catch (error) {
				const err = error as NodeJS.ErrnoException;
				if (err.code !== "EADDRINUSE") throw err;
				lastError = err;
			}
		}

		throw new Error(
			`No free port in range ${this.requestedPort}-${
				this.requestedPort + PORT_SCAN_RANGE
			} (last error: ${lastError?.message})`,
		);
	}

	/**
	 * Bind a single port, resolving once listening and rejecting on any error.
	 */
	private listenOn(port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const server = createServer(this.handleRequest.bind(this));

			const onError = (error: NodeJS.ErrnoException) => {
				server.close();
				reject(error);
			};

			server.once("error", onError);

			// The limiter's key map would otherwise grow once per distinct key
			// forever -- an unbounded-memory bug inside the thing meant to
			// prevent one.
			if (!this.pruneInterval) {
				this.pruneInterval = setInterval(
					() => this.rateLimiter.prune(),
					RATE_WINDOW_MS,
				);
				this.pruneInterval.unref?.();
			}

			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", onError);
				this.server = server;
				const addr = server.address();
				this.actualPort = typeof addr === "object" ? (addr?.port ?? 0) : port;
				resolve();
			});
		});
	}

	/**
	 * Get the actual port the server is listening on
	 */
	getPort(): number {
		return this.actualPort;
	}

	/**
	 * Stop the HTTP server
	 */
	async stop(): Promise<void> {
		if (this.pruneInterval) {
			clearInterval(this.pruneInterval);
			this.pruneInterval = null;
		}
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => {
					this.server = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * Handle incoming HTTP requests
	 */
	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		// This server exists to receive hook events from local processes (a hook
		// script's curl, or Claude Code's own `"type": "http"` hook). None of those
		// are browsers, so no cross-origin access is needed.
		//
		// It previously sent `Access-Control-Allow-Origin: *`, which invited any
		// web page the user had open to POST fabricated sessions and log entries,
		// and -- because ingest reads whatever file path the payload names -- to
		// make the core open arbitrary files and surface their contents in the UI.
		// Requests carrying an Origin are browser-initiated by definition, so
		// reject them outright rather than advertising permission.
		const origin = req.headers.origin;
		if (origin !== undefined) {
			this.sendJson(
				res,
				{ success: false, error: "Cross-origin requests are not accepted" },
				403,
			);
			return;
		}

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url || "/", `http://localhost:${this.actualPort}`);

		try {
			switch (url.pathname) {
				// Primary endpoint per Phase 1 spec
				case "/log":
				// Alias for backwards compatibility
				case "/api/log":
					if (req.method === "POST") {
						await this.handleLogPost(req, res);
					} else {
						this.sendMethodNotAllowed(res);
					}
					break;

				// A native Claude Code HTTP hook posts here: the raw event, with
				// no shell and no jq. The reshaping the shell hook does in
				// jq happens in hook-payload.ts instead, so both transports
				// produce identical records.
				case "/api/hook":
					if (req.method === "POST") {
						await this.handleNativeHook(req, res);
					} else {
						this.sendMethodNotAllowed(res);
					}
					break;

				// The subagent briefing hook posts here. HTTP rather than IPC
				// because a hook is a short-lived shell script and the core's
				// stdio belongs to the extension.
				case "/api/briefing":
					if (req.method === "POST") {
						await this.handleBriefing(req, res);
					} else {
						this.sendMethodNotAllowed(res);
					}
					break;

				case "/api/health":
					this.handleHealth(res);
					break;

				case "/api/stats":
					this.handleStats(res);
					break;

				// Debug endpoints for visibility into all data
				case "/api/debug":
					await this.handleDebug(res, url);
					break;

				case "/api/logs":
					await this.handleGetLogs(res, url);
					break;

				case "/api/sessions":
					await this.handleGetSessions(res);
					break;

				case "/api/changes":
					await this.handleGetChanges(res);
					break;

				default:
					this.sendNotFound(res);
			}
		} catch (error) {
			this.sendError(res, error);
		}
	}

	/**
	 * Handle POST /log (or /api/log) - receive log from hooks
	 */
	private async handleLogPost(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		// Rate-limited per peer. Only the write path is limited: the read
		// endpoints are cheap and are what a status script polls.
		const peer = req.socket.remoteAddress ?? "unknown";
		const limit = this.rateLimiter.check(peer);
		res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
		res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
		res.setHeader("X-RateLimit-Reset", String(Math.ceil(limit.resetAt / 1000)));
		if (!limit.allowed) {
			this.sendJson(res, { success: false, error: "Rate limit exceeded" }, 429);
			return;
		}

		const body = await this.readBody(req);

		try {
			const parsed = JSON.parse(body) as Partial<LogEntry> & {
				executionId?: string;
			};

			// Redact credentials BEFORE anything is stored or broadcast. Payloads
			// carry prompts, tool I/O and file contents, so they routinely contain
			// keys and tokens -- and everything here is written to disk in plain
			// text and shown on screen.
			const logData = this.redactSecrets ? redactPayload(parsed).value : parsed;

			// Validate required fields
			if (!logData.hook || !logData.event) {
				this.sendBadRequest(res, "Missing required fields: hook, event");
				return;
			}

			// Validate sessionId for hooks that require it
			const sessionRequiredHooks = [
				"PreToolUse",
				"PostToolUse",
				"SessionStart",
				"SessionEnd",
				"UserPromptSubmit",
				"Stop",
				"Notification",
				"SubagentStop",
			];
			if (sessionRequiredHooks.includes(logData.hook) && !logData.sessionId) {
				this.sendBadRequest(
					res,
					`Missing required sessionId for hook: ${logData.hook}`,
				);
				return;
			}

			const log = await this.ingestLog(logData);
			this.sendJson(res, { success: true, id: log.id });
		} catch (error) {
			if (error instanceof SyntaxError) {
				this.sendBadRequest(res, "Invalid JSON");
			} else {
				throw error;
			}
		}
	}

	/**
	 * Store one already-validated log and run the file-tracking workflow.
	 *
	 * Extracted so the shell transport (`/log`) and the native HTTP hook
	 * transport (`/api/hook`) cannot drift: a difference between them would
	 * mean an event captured one way and lost the other, which is the hardest
	 * kind of gap to notice.
	 */
	private async ingestLog(logData: Partial<LogEntry>): Promise<LogEntry> {
		const log = await this.logManager.addLog(logData);

		if (log.sessionId) {
			this.sessionManager.trackActivity(log.sessionId, log);
		}

		// File tracking workflow for Edit/Write tools:
		// - On PreToolUse: capture BEFORE content from disk
		// - On PostToolUse: read AFTER content from disk and detect change
		if (log.file && log.tool && (log.tool === "Edit" || log.tool === "Write")) {
			if (log.event === "PreToolUse") {
				await this.fileTracker.captureBeforeContent(
					log.file,
					log.sessionId || "unknown",
					log.tool,
				);
			} else if (log.event === "PostToolUse") {
				const change = await this.fileTracker.trackFromLog(log);
				if (change && log.sessionId) {
					this.sessionManager.addFileChange(log.sessionId, change.id);
				}
			}
		}

		return log;
	}

	/**
	 * Ingest one native Claude Code hook payload (M2).
	 *
	 * ALWAYS answers `{}` with 200, including on malformed input. Claude Code
	 * reads this response AS HOOK OUTPUT, so anything else risks the observer
	 * changing the session it observes: an error body can surface to the user,
	 * and a `decision` field would block a tool call. An observability tool
	 * that can veto a tool call is a different product.
	 */
	private async handleNativeHook(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			const raw = await this.readBody(req);
			const log = normaliseHookPayload(JSON.parse(raw));
			if (log) {
				// Same redaction as the shell path, and before anything is stored
				// or broadcast: payloads carry prompts, tool I/O and file
				// contents, so they routinely contain keys and tokens.
				await this.ingestLog(
					(this.redactSecrets
						? redactPayload(log).value
						: log) as Partial<LogEntry>,
				);
			}
		} catch {
			// Malformed body, or an ingest that threw. Stay silent rather than
			// answering a hook with an error it would show the user.
		}
		this.sendJson(res, {}, 200);
	}

	/**
	 * Handle GET /api/health
	 */
	/**
	 * Answer a briefing request.
	 *
	 * Always answers, and answers with an empty briefing rather than an error
	 * when no provider is configured: the caller is a PreToolUse hook, and a
	 * hook that gets a 500 must not be the reason a tool call fails.
	 */
	private async handleBriefing(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		let body: Record<string, unknown> = {};
		try {
			body = JSON.parse(await this.readBody(req)) as Record<string, unknown>;
		} catch {
			// A malformed request still gets a usable answer.
		}
		if (!this.getBriefingFn) {
			this.sendJson(res, { text: "", cited: 0, empty: true });
			return;
		}
		try {
			const briefing = await this.getBriefingFn({
				task: typeof body.task === "string" ? body.task : undefined,
				projectKey:
					typeof body.projectKey === "string" ? body.projectKey : undefined,
				maxChars: typeof body.maxChars === "number" ? body.maxChars : undefined,
			});
			this.sendJson(res, briefing);
		} catch (error) {
			this.sendJson(res, {
				text: "",
				cited: 0,
				empty: true,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private handleHealth(res: ServerResponse): void {
		this.sendJson(res, {
			status: "healthy",
			version: "0.1.0",
			uptime: process.uptime(),
		});
	}

	/**
	 * Handle GET /api/stats
	 */
	private handleStats(res: ServerResponse): void {
		const stats = this.logManager.getStats();
		this.sendJson(res, stats);
	}

	/**
	 * Handle GET /api/debug - comprehensive system dump
	 */
	private async handleDebug(res: ServerResponse, url: URL): Promise<void> {
		const limit = parseInt(url.searchParams.get("limit") || "50", 10);

		const logsResult = await this.logManager.getLogs({
			pagination: { limit, offset: 0 },
		});
		const sessionsResult = await this.sessionManager.getSessions({ limit });
		const changesResult = await this.fileTracker.getPendingChanges({});

		// Get recent logs with tool info
		const toolLogs = logsResult.logs.filter(
			(log) => log.hook === "PreToolUse" || log.hook === "PostToolUse",
		);

		this.sendJson(res, {
			timestamp: new Date().toISOString(),
			stats: this.logManager.getStats(),
			summary: {
				totalLogs: logsResult.total,
				toolLogs: toolLogs.length,
				sessions: sessionsResult.sessions.length,
				pendingChanges: changesResult.changes.length,
			},
			recentLogs: logsResult.logs.slice(0, 20).map((log) => ({
				id: log.id,
				timestamp: log.timestamp,
				hook: log.hook,
				event: log.event,
				tool: log.tool,
				file: log.file,
				sessionId: log.sessionId,
				message: log.message,
				hasDetails: !!log.details,
				detailsKeys: log.details ? Object.keys(log.details) : [],
			})),
			recentToolLogs: toolLogs.slice(0, 10).map((log) => ({
				id: log.id,
				timestamp: log.timestamp,
				hook: log.hook,
				tool: log.tool,
				file: log.file,
				sessionId: log.sessionId,
				details: log.details,
			})),
			sessions: sessionsResult.sessions.slice(0, 10),
			pendingChanges: changesResult.changes.slice(0, 10),
		});
	}

	/**
	 * Handle GET /api/logs - list all logs
	 */
	private async handleGetLogs(res: ServerResponse, url: URL): Promise<void> {
		const limit = parseInt(url.searchParams.get("limit") || "100", 10);
		const offset = parseInt(url.searchParams.get("offset") || "0", 10);
		const hook = url.searchParams.get("hook") || undefined;
		const tool = url.searchParams.get("tool") || undefined;

		const result = await this.logManager.getLogs({
			filter: { hook, tool },
			pagination: { limit, offset },
		});

		this.sendJson(res, result);
	}

	/**
	 * Handle GET /api/sessions - list all sessions
	 */
	private async handleGetSessions(res: ServerResponse): Promise<void> {
		const result = await this.sessionManager.getSessions({ limit: 50 });
		this.sendJson(res, result);
	}

	/**
	 * Handle GET /api/changes - list pending file changes
	 */
	private async handleGetChanges(res: ServerResponse): Promise<void> {
		const result = await this.fileTracker.getPendingChanges({});
		this.sendJson(res, result);
	}

	/**
	 * Read request body as string
	 */
	private readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks).toString()));
			req.on("error", reject);
		});
	}

	/**
	 * Send JSON response
	 */
	private sendJson(res: ServerResponse, data: unknown, status = 200): void {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(data));
	}

	/**
	 * Send error responses
	 */
	private sendBadRequest(res: ServerResponse, message: string): void {
		this.sendJson(res, { success: false, error: message }, 400);
	}

	private sendNotFound(res: ServerResponse): void {
		this.sendJson(res, { success: false, error: "Not found" }, 404);
	}

	private sendMethodNotAllowed(res: ServerResponse): void {
		this.sendJson(res, { success: false, error: "Method not allowed" }, 405);
	}

	private sendError(res: ServerResponse, error: unknown): void {
		const message =
			error instanceof Error ? error.message : "Internal server error";
		this.sendJson(res, { success: false, error: message }, 500);
	}
}
