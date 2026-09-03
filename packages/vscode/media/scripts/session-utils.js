/**
 * Pure helpers shared by the Sessions and File Changes views.
 *
 * Moved verbatim out of the 1539-line views/sessions.js. Composed onto
 * SessionsView with Object.assign, so `this` resolves exactly as before.
 */

const SessionUtils = {

	/**
	 * Get a human-readable display name for a session
	 * Returns an object with projectName and shortId
	 * @param {Object} session
	 * @returns {{ projectName: string, shortId: string, fullDisplay: string }}
	 */
	getSessionDisplayInfo(session) {
		let projectName = "";

		// 1. Try session.name (new field - populated by backend)
		if (session.name) {
			projectName = session.name;
		}
		// 2. Try project name from metadata, or flattened onto a summary
		else if (session.metadata?.projectName || session.projectName) {
			projectName = session.metadata?.projectName || session.projectName;
		}
		// 3. Try to extract folder name from working directory
		else if (session.metadata?.workingDirectory) {
			const path = session.metadata.workingDirectory;
			// Get last non-empty segment of path
			const segments = path.split(/[/\\]/).filter((s) => s);
			if (segments.length > 0) {
				projectName = segments[segments.length - 1];
			}
		}

		// Short session ID (first 8 chars)
		const shortId = session.id.slice(0, 8);

		// Full display combines both
		const fullDisplay = projectName ? `${projectName} • ${shortId}` : shortId;

		return { projectName, shortId, fullDisplay };
	},


	/**
	 * Get a human-readable display name for a session (legacy, for compatibility)
	 * Priority: metadata.projectName > folder from workingDirectory > truncated ID
	 * Optionally includes git branch: "projectName (branch)"
	 * @param {Object} session
	 * @param {boolean} includeBranch - whether to include git branch if available
	 * @returns {string}
	 */
	getSessionDisplayName(session, includeBranch = false) {
		const info = this.getSessionDisplayInfo(session);

		// Optionally include git branch
		const branch = this.gitBranchOf(session);
		if (includeBranch && branch) {
			return `${info.fullDisplay} (${branch})`;
		}

		return info.fullDisplay;
	},


	/**
	 * Count errors in a session
	 * @param {Object} session
	 * @returns {number}
	 */
	countErrors(session) {
		if (typeof session.errorCount === "number") return session.errorCount;
		if (!session.toolExecutions) return 0;
		return session.toolExecutions.filter(
			(t) => t.status === "error" || t.status === "failed",
		).length;
	},

	/*
	 * A session reaches this view in two shapes: the full Session from
	 * sessions.getAll, and the SessionSummary the activity response carries.
	 * The summary omits toolExecutions - which is the whole point, it dominated
	 * the payload - and pre-counts instead. These read either shape so the list
	 * and header do not care which one they were handed.
	 */


	/** @param {Object} s @returns {number} */
	toolCount(s) {
		if (typeof s.toolExecutionCount === "number") return s.toolExecutionCount;
		return s.toolExecutions?.length || 0;
	},


	/** @param {Object} s @returns {number} */
	fileCount(s) {
		if (typeof s.fileChangeCount === "number") return s.fileChangeCount;
		return s.fileChanges?.length || 0;
	},


	/** @param {Object} s @returns {string|undefined} */
	gitBranchOf(s) {
		return s.metadata?.gitBranch || s.gitBranch || undefined;
	},


	/**
	 * Generate a stable hash for a string (for activity IDs)
	 * @param {string} str
	 * @returns {string}
	 */
	hashString(str) {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash = hash & hash;
		}
		return Math.abs(hash).toString(16);
	},


	/**
	 * Generate a stable activity ID
	 * @param {Object} activity
	 * @param {string} type
	 * @returns {string}
	 */
	generateActivityId(activity, type) {
		if (activity.id) return activity.id;

		if (type === "tool_call" && activity.tool) {
			const inputHash = this.hashString(JSON.stringify(activity.input || ""));
			return `tool-${activity.tool}-${activity.startTime}-${inputHash.slice(0, 8)}`;
		}

		const contentHash = this.hashString(
			JSON.stringify(activity.data || activity),
		);
		return `${type}-${activity.timestamp}-${contentHash.slice(0, 8)}`;
	},


	/**
	 * Safely stringify a value for display
	 * @param {*} value
	 * @param {number} maxLength
	 * @returns {string}
	 */
	safeStringify(value, maxLength = 2000) {
		if (value === null || value === undefined) return "";
		try {
			const str =
				typeof value === "object"
					? JSON.stringify(value, null, 2)
					: String(value);
			return str.slice(0, maxLength);
		} catch (e) {
			return "[Unable to display]";
		}
	},


	/**
	 * Safely get an array (returns empty array if not array)
	 * @param {*} arr
	 * @returns {Array}
	 */
	safeArray(arr) {
		return Array.isArray(arr) ? arr : [];
	},


	/**
	 * Coerce a backend activity item into a shape the renderers can trust.
	 *
	 * The contract is produced untyped (`data: unknown` server-side), so this is
	 * the trust boundary. It matters concretely: several renderers reach straight
	 * into `activity.data.x`, which throws if data is null - one malformed item
	 * would take out the whole feed rather than degrading to a single "unknown"
	 * bubble.
	 *
	 * @param {*} raw
	 * @returns {Object|null} null when the item is unusable
	 */
	normalizeActivity(raw) {
		if (!raw || typeof raw !== "object") return null;
		return {
			...raw,
			type: typeof raw.type === "string" ? raw.type : "message",
			timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
			data: raw.data && typeof raw.data === "object" ? raw.data : {},
		};
	},


	/**
	 * Stable item id for a Tools-tab row
	 * @param {number} idx
	 * @returns {string}
	 */
	toolItemId(idx) {
		return `tools-tab-${idx}`;
	},


	/**
	 * Format a tool execution's duration.
	 *
	 * Prefers the hook-reported duration. Hook timestamps are second-resolution
	 * (the script stamps `date -u +...%SZ`), so subtracting them can only ever
	 * yield a multiple of 1000ms or 0 - fiction for calls that take tens of ms.
	 *
	 * The real figure arrives as `details.durationMs`. SessionManager assigns
	 * `exec.result = log.details`, so on a ToolExecution it surfaces under
	 * `result.durationMs`; a future direct field is checked first. Activity-tab
	 * bubbles do not carry it yet - getActivity picks `details.tool_result` as
	 * `result`, which drops the sibling keys - so those still fall back.
	 *
	 * @param {Object} tool
	 * @returns {string}
	 */
	formatToolDuration(tool) {
		const reported =
			typeof tool.durationMs === "number"
				? tool.durationMs
				: typeof tool.result?.durationMs === "number"
					? tool.result.durationMs
					: null;
		if (reported !== null) return `${reported}ms`;

		if (tool.startTime && tool.endTime) {
			return `${new Date(tool.endTime) - new Date(tool.startTime)}ms`;
		}
		return "";
	},


	/**
	 * Get tool type for styling
	 * @param {string} toolName
	 * @returns {string}
	 */
	getToolType(toolName) {
		const name = (toolName || "").toLowerCase();
		if (name.includes("read")) return "read";
		if (name.includes("write")) return "write";
		if (name.includes("edit")) return "edit";
		if (name.includes("bash") || name.includes("execute")) return "bash";
		if (
			name.includes("glob") ||
			name.includes("grep") ||
			name.includes("search")
		)
			return "search";
		if (name.includes("task") || name.includes("agent")) return "agent";
		return "other";
	},


	/**
	 * Get status icon
	 * @param {string} status
	 * @returns {string}
	 */
	getStatusIcon(status) {
		switch (status) {
			case "completed":
			case "success":
				return "&#10003;";
			case "error":
			case "failed":
				return "&#10007;";
			case "running":
				return "&#8226;";
			default:
				return "&#8226;";
		}
	},
};

window.SessionUtils = SessionUtils;
