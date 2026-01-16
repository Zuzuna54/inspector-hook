/**
 * HTTP Server for hook log ingestion
 * Receives logs via POST /api/log from hook scripts
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
	private port: number;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;

	constructor(options: HttpServerOptions) {
		this.port = options.port;
		this.logManager = options.logManager;
		this.sessionManager = options.sessionManager;
		this.fileTracker = options.fileTracker;
	}

	/**
	 * Start the HTTP server
	 */
	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = createServer(this.handleRequest.bind(this));

			this.server.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "EADDRINUSE") {
					reject(new Error(`Port ${this.port} is already in use`));
				} else {
					reject(error);
				}
			});

			this.server.listen(this.port, "127.0.0.1", () => {
				resolve();
			});
		});
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

		const url = new URL(req.url || "/", `http://localhost:${this.port}`);

		try {
			switch (url.pathname) {
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
	 * Handle POST /api/log - receive log from hooks
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

			// Track file changes for relevant events
			if (log.file && log.tool) {
				this.fileTracker.trackFromLog(log);
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
