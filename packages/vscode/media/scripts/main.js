/**
 * Inspector Hook Webview Script
 * Handles UI interactions and VS Code communication
 */

// VS Code API
const vscode = acquireVsCodeApi();

// State
const state = {
	currentTab: "dashboard",
	logs: [],
	sessions: [],
	fileChanges: [],
	stats: null,
	selectedChangeId: null,
	config: {
		autoScroll: true,
	},
};

// DOM Elements
const elements = {
	// Stats
	statErrors: document.getElementById("stat-errors"),
	statChanges: document.getElementById("stat-changes"),
	totalLogs: document.getElementById("total-logs"),
	totalErrors: document.getElementById("total-errors"),
	totalWarnings: document.getElementById("total-warnings"),
	totalBlocked: document.getElementById("total-blocked"),

	// Views
	dashboardView: document.getElementById("dashboard-view"),
	logsView: document.getElementById("logs-view"),
	sessionsView: document.getElementById("sessions-view"),
	fileChangesView: document.getElementById("file-changes-view"),

	// Content containers
	recentLogs: document.getElementById("recent-logs"),
	logsTable: document.getElementById("logs-table"),
	sessionsList: document.getElementById("sessions-list"),
	changesList: document.getElementById("changes-list"),
	diffViewer: document.getElementById("diff-viewer"),

	// Controls
	searchInput: document.getElementById("search"),
	clearBtn: document.getElementById("clear-btn"),
	tabs: document.querySelectorAll(".tab"),
};

// =============================================================================
// Initialization
// =============================================================================

function init() {
	// Set up tab switching
	elements.tabs.forEach((tab) => {
		tab.addEventListener("click", () => {
			const tabName = tab.dataset.tab;
			switchTab(tabName);
		});
	});

	// Set up search
	elements.searchInput?.addEventListener("input", debounce(handleSearch, 300));

	// Set up clear button
	elements.clearBtn?.addEventListener("click", handleClear);

	// Set up file changes list click handler
	elements.changesList?.addEventListener("click", handleChangeClick);

	// Listen for messages from extension
	window.addEventListener("message", handleMessage);
}

// =============================================================================
// Tab Management
// =============================================================================

function switchTab(tabName) {
	state.currentTab = tabName;

	// Update tab buttons
	elements.tabs.forEach((tab) => {
		tab.classList.toggle("active", tab.dataset.tab === tabName);
	});

	// Update views
	const views = ["dashboard", "logs", "sessions", "file-changes"];
	views.forEach((view) => {
		const viewElement = document.getElementById(`${view}-view`);
		if (viewElement) {
			viewElement.classList.toggle("active", view === tabName);
		}
	});

	// Load data for the tab if needed
	if (tabName === "logs") {
		requestLogs();
	}
}

// =============================================================================
// Message Handling
// =============================================================================

function handleMessage(event) {
	const message = event.data;

	switch (message.type) {
		case "init":
			handleInit(message.payload);
			break;
		case "stats":
			handleStats(message.payload);
			break;
		case "log":
			handleNewLog(message.payload);
			break;
		case "logs":
			handleLogs(message.payload);
			break;
		case "diff-result":
			handleDiffResult(message.payload);
			break;
		default:
			// Unknown message types are silently ignored
			break;
	}
}

function handleInit(data) {
	if (data.stats) handleStats(data.stats);
	if (data.logs) {
		state.logs = data.logs;
		renderRecentLogs();
		renderLogsTable();
	}
	if (data.sessions) {
		state.sessions = data.sessions;
		renderSessions();
	}
	if (data.fileChanges) {
		state.fileChanges = data.fileChanges;
		renderFileChanges();
	}
	if (data.config) {
		Object.assign(state.config, data.config);
	}
}

function handleStats(stats) {
	state.stats = stats;
	renderStats();
}

function handleNewLog(log) {
	state.logs.unshift(log);
	if (state.logs.length > 1000) {
		state.logs = state.logs.slice(0, 1000);
	}

	renderRecentLogs();
	if (state.currentTab === "logs") {
		renderLogsTable();
	}
}

function handleLogs(data) {
	state.logs = data.logs || [];
	renderLogsTable();
}

function handleDiffResult(diff) {
	renderDiff(diff);
}

// =============================================================================
// Rendering
// =============================================================================

function renderStats() {
	const stats = state.stats;
	if (!stats) return;

	if (elements.statErrors) {
		elements.statErrors.textContent = `${stats.errors} errors`;
	}
	if (elements.statChanges) {
		elements.statChanges.textContent = `${stats.pendingChanges} changes`;
	}
	if (elements.totalLogs) {
		elements.totalLogs.textContent = stats.totalLogs;
	}
	if (elements.totalErrors) {
		elements.totalErrors.textContent = stats.errors;
	}
	if (elements.totalWarnings) {
		elements.totalWarnings.textContent = stats.warnings;
	}
	if (elements.totalBlocked) {
		elements.totalBlocked.textContent = stats.blocked;
	}
}

function renderRecentLogs() {
	if (!elements.recentLogs) return;

	const recentLogs = state.logs.slice(0, 10);

	if (recentLogs.length === 0) {
		elements.recentLogs.innerHTML =
			'<div class="empty-state">No recent activity</div>';
		return;
	}

	elements.recentLogs.innerHTML = recentLogs
		.map(
			(log) => `
      <div class="log-item ${log.level}">
        <span class="log-time">${formatTime(log.timestamp)}</span>
        <span class="log-hook">${escapeHtml(log.hook)}</span>
        <span class="log-message">${escapeHtml(log.message || log.event)}</span>
      </div>
    `,
		)
		.join("");
}

function renderLogsTable() {
	if (!elements.logsTable) return;

	if (state.logs.length === 0) {
		elements.logsTable.innerHTML = '<div class="empty-state">No logs yet</div>';
		return;
	}

	elements.logsTable.innerHTML = `
    <table class="log-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Level</th>
          <th>Hook</th>
          <th>Event</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        ${state.logs
					.map(
						(log) => `
          <tr class="${log.level}">
            <td>${formatTime(log.timestamp)}</td>
            <td>${log.level}</td>
            <td>${escapeHtml(log.hook)}</td>
            <td>${escapeHtml(log.event)}</td>
            <td>${escapeHtml(log.message || "")}</td>
          </tr>
        `,
					)
					.join("")}
      </tbody>
    </table>
  `;
}

function renderSessions() {
	if (!elements.sessionsList) return;

	if (state.sessions.length === 0) {
		elements.sessionsList.innerHTML =
			'<div class="empty-state">No sessions</div>';
		return;
	}

	elements.sessionsList.innerHTML = state.sessions
		.map(
			(session) => `
      <div class="session-item ${session.status}">
        <div class="session-status ${session.status}"></div>
        <div class="session-info">
          <div class="session-name">${escapeHtml(session.name || session.id)}</div>
          <div class="session-meta">
            ${formatDuration(session.startTime, session.endTime)} •
            ${session.toolCount || 0} tools •
            ${session.fileChanges || 0} files
          </div>
        </div>
      </div>
    `,
		)
		.join("");
}

function renderFileChanges() {
	if (!elements.changesList) return;

	if (state.fileChanges.length === 0) {
		elements.changesList.innerHTML =
			'<div class="empty-state">No pending changes</div>';
		return;
	}

	elements.changesList.innerHTML = state.fileChanges
		.map(
			(change) => `
      <div class="change-item ${change.id === state.selectedChangeId ? "selected" : ""}" data-change-id="${change.id}">
        <span class="change-type ${change.changeType}">${change.changeType}</span>
        <span class="change-file">${getFileName(change.filePath)}</span>
      </div>
    `,
		)
		.join("");
}

function renderDiff(diff) {
	if (!elements.diffViewer) return;

	if (!diff || !diff.hunks || diff.hunks.length === 0) {
		elements.diffViewer.innerHTML =
			'<div class="empty-state">No diff available</div>';
		return;
	}

	const linesHtml = diff.hunks
		.flatMap((hunk) =>
			hunk.lines.map(
				(line) => `
        <div class="diff-line ${line.type}">
          <span class="diff-line-number">${line.lineNumber || ""}</span>
          <span class="diff-line-content">${escapeHtml(line.content)}</span>
        </div>
      `,
			),
		)
		.join("");

	elements.diffViewer.innerHTML = `
    <div class="diff-header">
      <span>+${diff.additions} -${diff.deletions}</span>
    </div>
    <div class="diff-content">
      ${linesHtml}
    </div>
  `;
}

// =============================================================================
// Event Handlers
// =============================================================================

function handleSearch(event) {
	const query = event.target.value;
	vscode.postMessage({
		command: "get-logs",
		params: { filter: { search: query } },
	});
}

function handleClear() {
	vscode.postMessage({
		command: "clear-logs",
	});
}

function handleChangeClick(event) {
	const changeItem = event.target.closest(".change-item");
	if (!changeItem) return;

	const changeId = changeItem.dataset.changeId;
	state.selectedChangeId = changeId;

	renderFileChanges();

	vscode.postMessage({
		command: "get-diff",
		params: { changeId },
	});
}

function requestLogs() {
	vscode.postMessage({
		command: "get-logs",
		params: { pagination: { limit: 100 } },
	});
}

// =============================================================================
// Utility Functions
// =============================================================================

function escapeHtml(text) {
	if (!text) return "";
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

function formatTime(timestamp) {
	if (!timestamp) return "";
	const date = new Date(timestamp);
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatDuration(startTime, endTime) {
	if (!startTime) return "";
	const start = new Date(startTime);
	const end = endTime ? new Date(endTime) : new Date();
	const ms = end - start;
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	} else {
		return `${seconds}s`;
	}
}

function getFileName(filePath) {
	if (!filePath) return "";
	return filePath.split("/").pop() || filePath;
}

function debounce(fn, delay) {
	let timeoutId;
	return function (...args) {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => fn.apply(this, args), delay);
	};
}

// =============================================================================
// Start
// =============================================================================

init();
