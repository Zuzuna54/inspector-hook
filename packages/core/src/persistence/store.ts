/**
 * Persistence Store
 * Handles saving and loading data to disk
 * Supports JSON files for structured data and JSONL for append-only logs
 */

import {
	appendFile,
	mkdir,
	readFile,
	readdir,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface PersistenceStoreOptions {
	basePath: string;
	maxLogFileSize?: number; // Max size in bytes before rotating (default: 10MB)
	maxLogFiles?: number; // Max number of log files to keep (default: 10)
}

export class PersistenceStore {
	private basePath: string;
	private maxLogFileSize: number;
	private maxLogFiles: number;
	private initialized = false;

	// Directory structure
	private readonly dirs = {
		sessions: "sessions",
		logs: "logs",
		versions: "versions",
		archives: "archives",
		changes: "changes",
		snapshots: "snapshots",
	};

	constructor(options: PersistenceStoreOptions) {
		this.basePath = options.basePath;
		this.maxLogFileSize = options.maxLogFileSize || 10 * 1024 * 1024; // 10MB
		this.maxLogFiles = options.maxLogFiles || 10;
	}

	/**
	 * Initialize the persistence store
	 * Creates necessary directories
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Create base directory
		if (!existsSync(this.basePath)) {
			await mkdir(this.basePath, { recursive: true });
		}

		// Create subdirectories
		for (const dir of Object.values(this.dirs)) {
			const fullPath = join(this.basePath, dir);
			if (!existsSync(fullPath)) {
				await mkdir(fullPath, { recursive: true });
			}
		}

		this.initialized = true;
	}

	/**
	 * Get the base path
	 */
	getBasePath(): string {
		return this.basePath;
	}

	// =========================================================================
	// JSON File Operations (for structured data)
	// =========================================================================

	/**
	 * Save data as JSON file
	 */
	async saveJSON<T>(category: string, id: string, data: T): Promise<void> {
		await this.ensureInitialized();
		const filePath = this.getJSONPath(category, id);
		const content = JSON.stringify(data, null, 2);
		await writeFile(filePath, content, "utf-8");
	}

	/**
	 * Load data from JSON file
	 */
	async loadJSON<T>(category: string, id: string): Promise<T | null> {
		await this.ensureInitialized();
		const filePath = this.getJSONPath(category, id);
		try {
			const content = await readFile(filePath, "utf-8");
			return JSON.parse(content) as T;
		} catch {
			return null;
		}
	}

	/**
	 * Delete a JSON file
	 */
	async deleteJSON(category: string, id: string): Promise<boolean> {
		await this.ensureInitialized();
		const filePath = this.getJSONPath(category, id);
		try {
			await unlink(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Check if a JSON file exists
	 */
	async existsJSON(category: string, id: string): Promise<boolean> {
		const filePath = this.getJSONPath(category, id);
		return existsSync(filePath);
	}

	/**
	 * List all JSON files in a category
	 */
	async listJSON(category: string): Promise<string[]> {
		await this.ensureInitialized();
		const dirPath = join(this.basePath, category);
		try {
			const files = await readdir(dirPath);
			return files
				.filter((f) => f.endsWith(".json"))
				.map((f) => f.replace(".json", ""));
		} catch {
			return [];
		}
	}

	/**
	 * Load all JSON files in a category
	 */
	async loadAllJSON<T>(category: string): Promise<Map<string, T>> {
		const ids = await this.listJSON(category);
		const results = new Map<string, T>();

		for (const id of ids) {
			const data = await this.loadJSON<T>(category, id);
			if (data !== null) {
				results.set(id, data);
			}
		}

		return results;
	}

	// =========================================================================
	// JSONL (JSON Lines) Operations (for append-only logs)
	// =========================================================================

	/**
	 * Append entry to a JSONL log file
	 */
	async appendLog(filename: string, entry: unknown): Promise<void> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);

		// Check if rotation is needed
		await this.rotateLogIfNeeded(filename);

		const line = JSON.stringify(entry) + "\n";
		await appendFile(filePath, line, "utf-8");
	}

	/**
	 * Load all entries from a JSONL log file
	 */
	async loadLogs<T>(filename: string): Promise<T[]> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			const content = await readFile(filePath, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);
			return lines.map((line) => JSON.parse(line) as T);
		} catch {
			return [];
		}
	}

	/**
	 * Load logs with streaming (for large files)
	 * Returns an async iterator
	 */
	async *streamLogs<T>(filename: string): AsyncGenerator<T> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			const content = await readFile(filePath, "utf-8");
			const lines = content.split("\n");
			for (const line of lines) {
				if (line.trim()) {
					yield JSON.parse(line) as T;
				}
			}
		} catch {
			// File doesn't exist or is empty
		}
	}

	/**
	 * Get the count of entries in a log file
	 */
	async getLogCount(filename: string): Promise<number> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			const content = await readFile(filePath, "utf-8");
			return content.trim().split("\n").filter(Boolean).length;
		} catch {
			return 0;
		}
	}

	/**
	 * Clear a log file
	 */
	async clearLog(filename: string): Promise<void> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			await writeFile(filePath, "", "utf-8");
		} catch {
			// Ignore if file doesn't exist
		}
	}

	/**
	 * Delete a log file
	 */
	async deleteLog(filename: string): Promise<boolean> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			await unlink(filePath);
			return true;
		} catch {
			return false;
		}
	}

	// =========================================================================
	// Version Snapshots (for file content history)
	// =========================================================================

	/**
	 * Save a version snapshot
	 */
	async saveVersion(
		filePath: string,
		versionNumber: number,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		await this.ensureInitialized();

		// Create file-specific directory
		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);
		if (!existsSync(versionDir)) {
			await mkdir(versionDir, { recursive: true });
		}

		// Save content
		const contentPath = join(versionDir, `v${versionNumber}.content`);
		await writeFile(contentPath, content, "utf-8");

		// Save metadata if provided
		if (metadata) {
			const metaPath = join(versionDir, `v${versionNumber}.meta.json`);
			await writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
		}
	}

	/**
	 * Load a version snapshot
	 */
	async loadVersion(
		filePath: string,
		versionNumber: number,
	): Promise<{ content: string; metadata?: Record<string, unknown> } | null> {
		await this.ensureInitialized();

		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);
		const contentPath = join(versionDir, `v${versionNumber}.content`);

		try {
			const content = await readFile(contentPath, "utf-8");
			let metadata: Record<string, unknown> | undefined;

			const metaPath = join(versionDir, `v${versionNumber}.meta.json`);
			try {
				const metaContent = await readFile(metaPath, "utf-8");
				metadata = JSON.parse(metaContent);
			} catch {
				// No metadata file
			}

			return { content, metadata };
		} catch {
			return null;
		}
	}

	/**
	 * List all versions for a file
	 */
	async listVersions(filePath: string): Promise<number[]> {
		await this.ensureInitialized();

		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);

		try {
			const files = await readdir(versionDir);
			const versions = files
				.filter((f) => f.endsWith(".content"))
				.map((f) => parseInt(f.replace("v", "").replace(".content", "")))
				.filter((n) => !isNaN(n))
				.sort((a, b) => a - b);
			return versions;
		} catch {
			return [];
		}
	}

	/**
	 * Delete a version
	 */
	async deleteVersion(filePath: string, versionNumber: number): Promise<boolean> {
		await this.ensureInitialized();

		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);
		const contentPath = join(versionDir, `v${versionNumber}.content`);
		const metaPath = join(versionDir, `v${versionNumber}.meta.json`);

		let deleted = false;
		try {
			await unlink(contentPath);
			deleted = true;
		} catch {
			// Ignore
		}
		try {
			await unlink(metaPath);
		} catch {
			// Ignore
		}

		return deleted;
	}

	// =========================================================================
	// Utility Methods
	// =========================================================================

	/**
	 * Get storage statistics
	 */
	async getStats(): Promise<{
		totalSize: number;
		sessionCount: number;
		logCount: number;
		versionCount: number;
		archiveCount: number;
	}> {
		await this.ensureInitialized();

		const sessionCount = (await this.listJSON(this.dirs.sessions)).length;
		const archiveCount = (await this.listJSON(this.dirs.archives)).length;

		// Count log entries
		let logCount = 0;
		const logFiles = await this.listLogFiles();
		for (const file of logFiles) {
			logCount += await this.getLogCount(file);
		}

		// Count versions
		let versionCount = 0;
		const versionDir = join(this.basePath, this.dirs.versions);
		try {
			const fileDirs = await readdir(versionDir);
			for (const dir of fileDirs) {
				const versions = await this.listVersions(dir);
				versionCount += versions.length;
			}
		} catch {
			// Versions directory might not exist
		}

		// Calculate total size (approximate)
		const totalSize = await this.calculateDirSize(this.basePath);

		return {
			totalSize,
			sessionCount,
			logCount,
			versionCount,
			archiveCount,
		};
	}

	/**
	 * Clean up old data
	 */
	async cleanup(options?: {
		maxAgeMs?: number;
		keepMinVersions?: number;
	}): Promise<{ deletedFiles: number; freedBytes: number }> {
		// TODO: Implement cleanup logic
		return { deletedFiles: 0, freedBytes: 0 };
	}

	// =========================================================================
	// Private Methods
	// =========================================================================

	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}
	}

	private getJSONPath(category: string, id: string): string {
		return join(this.basePath, category, `${id}.json`);
	}

	private getLogPath(filename: string): string {
		const name = filename.endsWith(".jsonl") ? filename : `${filename}.jsonl`;
		return join(this.basePath, this.dirs.logs, name);
	}

	private sanitizeFilePath(filePath: string): string {
		// Replace path separators and special chars with safe alternatives
		return filePath
			.replace(/[\/\\]/g, "__")
			.replace(/[<>:"|?*]/g, "_")
			.replace(/\.\./g, "__");
	}

	private async listLogFiles(): Promise<string[]> {
		const logDir = join(this.basePath, this.dirs.logs);
		try {
			const files = await readdir(logDir);
			return files.filter((f) => f.endsWith(".jsonl"));
		} catch {
			return [];
		}
	}

	private async rotateLogIfNeeded(filename: string): Promise<void> {
		const filePath = this.getLogPath(filename);
		try {
			const stats = await stat(filePath);
			if (stats.size >= this.maxLogFileSize) {
				await this.rotateLog(filename);
			}
		} catch {
			// File doesn't exist yet
		}
	}

	private async rotateLog(filename: string): Promise<void> {
		const logDir = join(this.basePath, this.dirs.logs);
		const baseName = filename.replace(".jsonl", "");

		// Find existing rotated files
		const files = await readdir(logDir);
		const rotatedFiles = files
			.filter((f) => f.startsWith(baseName) && f.includes("."))
			.sort()
			.reverse();

		// Delete oldest if we have too many
		while (rotatedFiles.length >= this.maxLogFiles) {
			const oldFile = rotatedFiles.pop()!;
			await unlink(join(logDir, oldFile));
		}

		// Rename current file with timestamp
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newName = `${baseName}.${timestamp}.jsonl`;
		const currentPath = this.getLogPath(filename);
		const newPath = join(logDir, newName);

		try {
			await rename(currentPath, newPath);
		} catch {
			// Ignore if file doesn't exist
		}
	}

	private async calculateDirSize(dirPath: string): Promise<number> {
		let totalSize = 0;
		try {
			const entries = await readdir(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(dirPath, entry.name);
				if (entry.isDirectory()) {
					totalSize += await this.calculateDirSize(fullPath);
				} else {
					const stats = await stat(fullPath);
					totalSize += stats.size;
				}
			}
		} catch {
			// Ignore errors
		}
		return totalSize;
	}
}
