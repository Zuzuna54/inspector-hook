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

export interface HttpServerOptions {
	port: number;
	logManager: LogManager;
	sessionManager: SessionManager;
	fileTracker: FileTracker;
}

export class HttpServer {
	private server: Server | null = null;
	private requestedPort: number;
	private actualPort: number = 0;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;

	constructor(options: HttpServerOptions) {
		this.requestedPort = options.port;
		this.logManager = options.logManager;
		this.sessionManager = options.sessionManager;
		this.fileTracker = options.fileTracker;
	}

	/**
	 * Start the HTTP server
	 * If port is 0, the OS will assign an available port
	 */
	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = createServer(this.handleRequest.bind(this));

			this.server.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "EADDRINUSE") {
					reject(new Error(`Port ${this.requestedPort} is already in use`));
				} else {
					reject(error);
				}
			});

			this.server.listen(this.requestedPort, "127.0.0.1", () => {
				const addr = this.server?.address();
				this.actualPort = typeof addr === "object" ? (addr?.port ?? 0) : 0;
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
		// CORS headers for development
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

				case "/api/health":
					this.handleHealth(res);
					break;

				case "/api/stats":
					this.handleStats(res);
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
		const body = await this.readBody(req);

		try {
			const logData = JSON.parse(body) as Partial<LogEntry>;

			// Validate required fields
			if (!logData.hook || !logData.event) {
				this.sendBadRequest(res, "Missing required fields: hook, event");
				return;
			}

			// Add log to manager
			const log = await this.logManager.addLog(logData);

			// Track session if session_id present
			if (log.sessionId) {
				this.sessionManager.trackActivity(log.sessionId, log);
			}

			// File tracking workflow for Edit/Write tools:
			// - On PreToolUse: capture BEFORE content from disk
			// - On PostToolUse: read AFTER content from disk and detect change
			if (log.file && log.tool && (log.tool === "Edit" || log.tool === "Write")) {
				if (log.event === "PreToolUse") {
					// Capture the before content BEFORE the tool modifies the file
					await this.fileTracker.captureBeforeContent(
						log.file,
						log.sessionId || "unknown",
						log.tool,
					);
				} else if (log.event === "PostToolUse") {
					// After tool execution, detect the change by reading current file content
					const change = await this.fileTracker.trackFromLog(log);
					// If a change was detected, link it to the session
					if (change && log.sessionId) {
						this.sessionManager.addFileChange(log.sessionId, change.id);
					}
				}
			}

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
	 * Handle GET /api/health
	 */
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
