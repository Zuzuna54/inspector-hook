/**
 * Memory and context-tray calls, lifted out of core-bridge.ts.
 *
 * That file is one method per IPC call, so it grows with every feature, and it
 * was the last one left over the size limit -- the tray pushed it further. The
 * split is by domain, which is what the plan called for.
 *
 * Built as a factory over a `send` function rather than a subclass: it keeps
 * `sendRequest` private on CoreBridge, and it makes this testable with a fake
 * sender and no process.
 *
 * Thin pass-throughs, deliberately. Every refusal reason from the core is
 * returned untouched: these operate on files the user wrote by hand, so "why
 * not" is the most useful thing the UI can show, and paraphrasing it here would
 * put a second, drifting explanation between the core and the reader.
 */

export type SendRequest = <T>(method: string, params?: unknown) => Promise<T>;

export function createMemoryBridge(send: SendRequest) {
	return {


		/** The tray and the exact text it would inject. */
		async getContextTray(): Promise<unknown> {
			return send("context.getTray", {});
		},

		async addContextItem(params: {
			kind: string;
			title: string;
			text: string;
			source?: Record<string, string>;
		}): Promise<unknown> {
			return send("context.addItem", params);
		},

		async updateContextItem(params: {
			itemId: string;
			text?: string;
			title?: string;
			include?: boolean;
		}): Promise<unknown> {
			return send("context.updateItem", params);
		},

		async resetContextItem(itemId: string): Promise<unknown> {
			return send("context.resetItem", { itemId });
		},

		async removeContextItem(itemId: string): Promise<unknown> {
			return send("context.removeItem", { itemId });
		},

		async reorderContextItems(itemIds: string[]): Promise<unknown> {
			return send("context.reorderItems", { itemIds });
		},

		async clearContextTray(): Promise<unknown> {
			return send("context.clearTray", {});
		},

		/**
		 * Freeze the tray for one session.
		 *
		 * `now` is one-shot; `pinned` repeats until unpinned or expired, and its
		 * expiry is mandatory rather than optional.
		 */
		async armContext(params: {
			tier: "now" | "pinned";
			targetSessionId: string;
			label?: string;
			ttlMs?: number;
		}): Promise<unknown> {
			return send("context.arm", params);
		},

		/** What is armed, plus what a pin has cost so far. */
		async getArmedContext(sessionId?: string): Promise<unknown> {
			return send("context.getArmed", sessionId ? { sessionId } : {});
		},

		async disarmContext(params: {
			tier: "now" | "pinned";
			targetSessionId: string;
		}): Promise<unknown> {
			return send("context.disarm", params);
		},

		/** Sessions that could receive context, newest activity first. */
		async getContextTargets(): Promise<unknown> {
			return send("context.getTargets", {});
		},

		/** Exactly what arming would write. */
		async previewContext(): Promise<unknown> {
			return send("context.preview", {});
		},

		/** Every project on the machine that has memory. */
		async getMemoryProjects(includeEmpty = false): Promise<unknown> {
			return send("memory.getProjects", { includeEmpty });
		},

		/** Reference an existing file from MEMORY.md, without touching the file. */
		async addMemoryToIndex(
			memoryDir: string,
			fileName: string,
		): Promise<unknown> {
			return send("memory.addToIndex", { memoryDir, fileName });
		},

		/** Drop a file's index line, leaving the file in place. */
		async removeMemoryFromIndex(
			memoryDir: string,
			fileName: string,
		): Promise<unknown> {
			return send("memory.removeFromIndex", { memoryDir, fileName });
		},

		/**
		 * Create or update a memory entry.
		 *
		 * `userInitiated` is what allows editing a note the user wrote by hand; the
		 * core refuses otherwise, which is correct for anything automated.
		 */
		async writeMemory(params: {
			memoryDir: string;
			name: string;
			description?: string;
			type?: string;
			body?: string;
			title?: string;
			userInitiated?: boolean;
		}): Promise<unknown> {
			return send("memory.write", params);
		},

		/** Delete a memory entry. `force` is required for a file we did not author. */
		async deleteMemory(
			memoryDir: string,
			fileName: string,
			force = false,
		): Promise<unknown> {
			return send("memory.delete", { memoryDir, fileName, force });
		},

		/**
		 * Stage context for the next session that starts.
		 *
		 * Returns exactly what will be injected. That is the point: the preview and
		 * the delivery cannot diverge if they are the same object, so nothing here
		 * reshapes it.
		 */
		async stageContext(params: {
			sessionId?: string;
			text?: string;
			label?: string;
			ttlMs?: number;
		}): Promise<unknown> {
			return send("memory.stageContext", params);
		},

		/** What is currently staged, or null. Expiry is applied on read. */
		async getStagedContext(): Promise<unknown> {
			return send("memory.getStagedContext", {});
		},

		/** Discard a staged pick before it is consumed. */
		async clearStagedContext(): Promise<unknown> {
			return send("memory.clearStagedContext", {});
		},

		/**
		 * Build a session's digest WITHOUT writing it.
		 *
		 * No `write` flag is accepted. v1 has no write button by decision, and the
		 * most durable way to keep that true is for the extension to be unable to
		 * express it — an option that cannot be passed cannot be passed by accident.
		 */
		async buildSessionDigest(sessionId: string): Promise<unknown> {
			return send("memory.buildDigest", { sessionId });
		},
	};
}

export type MemoryBridge = ReturnType<typeof createMemoryBridge>;
