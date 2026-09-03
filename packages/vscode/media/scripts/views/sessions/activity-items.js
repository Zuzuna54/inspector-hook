/**
 * Pure renderers - one activity item in, HTML out.
 *
 * Moved verbatim out of the 1539-line views/sessions.js. Composed onto
 * SessionsView with Object.assign, so `this` resolves exactly as before.
 */

const ActivityItemsMixin = {

	/**
	 * Banner shown when the feed does not reach the start of the session.
	 * The server caps the activity window; without this the oldest rendered
	 * item reads as the moment the session began.
	 * @param {number} shownCount
	 * @returns {string}
	 */
	renderTruncationNotice(shownCount) {
		const { activityTruncated, activityAvailableLogs } = State.sessionView;
		if (!activityTruncated) return "";

		// Deliberately "available", not "total": the core serves activity reads
		// from its retained window, so this is a floor on what the session
		// actually produced, not a lifetime count.
		const scope =
			typeof activityAvailableLogs === "number"
				? `of ${activityAvailableLogs} available`
				: "of more than are shown";

		return `
      <div class="sv-truncation-notice">
        Earlier activity not loaded &mdash; showing the most recent
        ${shownCount} ${scope}.
      </div>
    `;
	},


	/**
	 * Render a single activity item
	 * @param {Object} activity
	 * @param {number} idx
	 * @returns {string}
	 */
	renderActivityItem(activity, idx) {
		const itemId = activity.id || `activity-${idx}`;
		// Expansion state is resolved per-item by renderToolBubble; only tool
		// bubbles expand, so it is not needed here.
		const timestamp = Utils.formatTime(activity.timestamp);

		switch (activity.type) {
			case "user_prompt":
				return `
          <div class="sv-bubble sv-user" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">User</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(activity.data.prompt || "")}
            </div>
          </div>
        `;

			case "ai_response": {
				// assistantMessage is Claude's real reply text, from Stop's
				// last_assistant_message. Before it was plumbed through, this bubble
				// could only ever show the placeholder below.
				const aiMessage =
					activity.data?.assistantMessage ||
					activity.data?.message ||
					"Claude finished responding";
				// Stop carries no reason field on any Claude Code version - the old
				// stopReason/stop_reason/finish_reason lookup could never match.
				// Failure reasons live on StopFailure, which the core routes to a
				// separate error-level message item rather than attributing an API
				// error to Claude.
				const pending = Number(activity.data?.backgroundTasks) || 0;
				return `
          <div class="sv-bubble sv-ai" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">Claude</span>
              <span class="sv-bubble-time">${timestamp}</span>
              <span class="sv-response-indicator">${pending > 0 ? `Paused &mdash; ${pending} background task${pending === 1 ? "" : "s"}` : "Response Complete"}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(aiMessage)}
            </div>
          </div>
        `;
			}

			case "notification": {
				const notifData = activity.data || {};
				const notifType = notifData.notificationType || "";
				const notifIcon =
					notifType === "permission_prompt"
						? "🔐"
						: notifType === "idle_prompt"
							? "⏸️"
							: "🔔";
				return `
          <div class="sv-bubble sv-notification" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">${notifIcon} Notification</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(notifData.message || "")}
            </div>
          </div>
        `;
			}

			case "tool_call":
				return this.renderToolBubble(activity.data, idx, itemId);

			case "session_start": {
				const sessionData = activity.data || {};
				return `
          <div class="sv-bubble sv-session" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">Session Started</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${sessionData.projectName ? `<span class="sv-session-project">${Utils.escapeHtml(sessionData.projectName)}</span>` : ""}
              ${sessionData.gitBranch ? `<span class="sv-session-branch">${Utils.escapeHtml(sessionData.gitBranch)}</span>` : ""}
            </div>
          </div>
        `;
			}

			case "subagent_complete": {
				const subagentData = activity.data || {};
				const success = subagentData.success !== false;
				const statusIcon = success ? "✅" : "❌";
				const statusClass = success
					? "sv-subagent-success"
					: "sv-subagent-failed";
				const agentType = subagentData.subagentType || "Task";
				return `
          <div class="sv-bubble sv-subagent ${statusClass}" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">${statusIcon} Subagent: ${Utils.escapeHtml(agentType)}</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(subagentData.message || `${agentType} agent ${success ? "completed" : "failed"}`)}
            </div>
          </div>
        `;
			}

			case "message": {
				const msgData = activity.data || {};
				const levelClass =
					msgData.level === "error"
						? "sv-message-error"
						: msgData.level === "warn"
							? "sv-message-warn"
							: "";

				// A turn that ended on an API error arrives here rather than as an
				// ai_response, because StopFailure reuses last_assistant_message to
				// carry the error string. Name the failure instead of letting it
				// read as an ordinary hook message.
				if (msgData.stopError) {
					return `
          <div class="sv-bubble sv-message sv-message-error" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">&#9888; Turn failed</span>
              <span class="sv-bubble-time">${timestamp}</span>
              <span class="sv-stop-error-code">${Utils.escapeHtml(String(msgData.stopError))}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(String(msgData.errorDetails || msgData.message || "Claude stopped before finishing this turn."))}
            </div>
          </div>
        `;
				}

				return `
          <div class="sv-bubble sv-message ${levelClass}" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">${Utils.escapeHtml(msgData.hook || "Message")}</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${Utils.escapeHtml(msgData.message || "")}
            </div>
          </div>
        `;
			}

			default: {
				// Handle unknown activity types gracefully
				console.warn(
					`[SessionsView] Unknown activity type: ${activity.type}`,
					activity,
				);
				return `
          <div class="sv-bubble sv-unknown" data-item-id="${itemId}">
            <div class="sv-bubble-header">
              <span class="sv-bubble-role">&#9888; ${Utils.escapeHtml(activity.type || "Unknown")}</span>
              <span class="sv-bubble-time">${timestamp}</span>
            </div>
            <div class="sv-bubble-content">
              ${
								activity.data?.message
									? Utils.escapeHtml(String(activity.data.message))
									: `<em>Activity type "${Utils.escapeHtml(activity.type || "unknown")}" not recognized</em>`
							}
            </div>
          </div>
        `;
			}
		}
	},


	/**
	 * Render a tool call bubble
	 * @param {Object} tool
	 * @param {number} idx
	 * @param {string} activityId - Optional activity ID for tracking
	 * @returns {string}
	 */
	renderToolBubble(tool, idx, activityId) {
		const itemId = activityId || tool.id || `tool-${idx}`;
		const isExpanded = this._expandedItems.has(itemId);
		const timestamp = Utils.formatTime(tool.startTime);
		const status = tool.status || "completed";
		const isRunning = status === "running";
		const hasError = status === "error" || status === "failed";
		const toolName = tool.tool || "Unknown";
		const toolType = this.getToolType(toolName);

		const duration = this.formatToolDuration(tool);

		return `
      <div class="sv-bubble sv-tool ${status} ${isExpanded ? "expanded" : ""}" data-item-id="${itemId}">
        <div class="sv-bubble-header">
          <span class="sv-tool-badge ${toolType}">${Utils.escapeHtml(toolName)}</span>
          ${
						tool.agentType
							? `<span class="sv-agent-badge" title="Run by subagent: ${Utils.escapeHtml(tool.agentType)}">${Utils.escapeHtml(tool.agentType)}</span>`
							: ""
					}
          <span class="sv-bubble-time">${timestamp}</span>
          ${isRunning ? '<span class="sv-spinner"></span>' : ""}
          ${hasError ? '<span class="sv-error-badge">Error</span>' : ""}
          ${duration && !isRunning ? `<span class="sv-tool-duration">${duration}</span>` : ""}
          <span class="sv-tool-status ${status}">${this.getStatusIcon(status)}</span>
        </div>
        ${
					isExpanded
						? `
          ${this.renderToolDetails(tool)}
          <button class="sv-expand-btn" data-item-id="${itemId}">
            Hide details
          </button>
        `
						: `
          <button class="sv-expand-btn" data-item-id="${itemId}">
            Show details
          </button>
        `
				}
      </div>
    `;
	},
};

window.ActivityItemsMixin = ActivityItemsMixin;
