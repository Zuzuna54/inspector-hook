/**
 * Feed assembly: turns, incremental updates, running-tool refresh.
 *
 * Moved verbatim out of the 1539-line views/sessions.js. Composed onto
 * SessionsView with Object.assign, so `this` resolves exactly as before.
 */

const ActivityFeedMixin = {

	/**
	 * Render the Activity tab
	 * @param {HTMLElement} container
	 * @param {Object} session
	 */
	renderActivityTab(container, session) {
		// Build activity feed from tool executions and logs
		const activities = this.buildActivityFeed(session);

		if (activities.length === 0) {
			container.innerHTML = `
        <div class="sv-activity-empty">
          <div class="empty-state">
            <div class="empty-state-title">No activity yet</div>
            <div class="empty-state-description">Activity will appear here as the session progresses</div>
          </div>
        </div>
      `;
			this._renderedActivityIds.clear();
			this._lastActivityCount = 0;
			return;
		}

		// Track rendered items for incremental updates using activity.id
		this._renderedActivityIds.clear();
		activities.forEach((activity) => {
			this._renderedActivityIds.add(activity.id);
		});
		this._lastActivityCount = activities.length;

		// Full rebuild: the previous payloads are unreachable once the DOM is
		// replaced, so drop them rather than letting the map grow per render.
		this._copyPayloads.clear();

		// Group into user turns. A single-turn session gains nothing from the
		// wrapper, so render it flat and skip the chrome.
		const turns = this.groupIntoTurns(activities);
		this._renderedTurnKeys = turns.map((t) => t.key);

		let body;
		if (turns.length <= 1) {
			body = activities
				.map((activity, idx) => this.renderActivityItem(activity, idx))
				.join("");
		} else {
			this.seedTurnCollapse(turns, session.id);
			let offset = 0;
			body = turns
				.map((turn) => {
					const html = this.renderTurn(turn, offset);
					offset += turn.items.length;
					return html;
				})
				.join("");
		}

		container.innerHTML = `
      <div class="sv-activity-feed">
        ${this.renderTruncationNotice(activities.length)}
        ${body}
      </div>
    `;
	},


	/**
	 * Incrementally update activity feed without full re-render
	 * Only appends new items and updates changed items
	 */
	updateActivityFeed() {
		const contentEl = document.getElementById("sv-detail-content");
		if (!contentEl) return;

		const session = this.getSelectedSession();
		if (!session) return;

		const feedEl = contentEl.querySelector(".sv-activity-feed");
		if (!feedEl) {
			// No feed exists yet, do full render
			this.renderActivityTab(contentEl, session);
			return;
		}

		const activities = this.buildActivityFeed(session);

		// If we have fewer items than before, something changed - do full render
		if (activities.length < this._lastActivityCount) {
			this.renderActivityTab(contentEl, session);
			return;
		}

		// Find new items (items we haven't rendered yet)
		const newActivities = activities.filter((activity) => {
			return !this._renderedActivityIds.has(activity.id);
		});

		if (newActivities.length === 0) {
			// No new items, maybe update running tool statuses
			this.updateRunningTools(feedEl, activities);
			return;
		}

		// A new turn changes the structure, not just the contents, so it needs a
		// full render. Appending within the current turn stays incremental, which
		// is the common case - a turn opens once per user message but accumulates
		// tool calls continuously.
		const turns = this.groupIntoTurns(activities);
		const grouped = turns.length > 1;
		if (grouped) {
			const keys = turns.map((t) => t.key);
			const known = this._renderedTurnKeys || [];
			const structureChanged =
				keys.length !== known.length ||
				keys.some((key, i) => key !== known[i]);
			if (structureChanged) {
				this.renderActivityTab(contentEl, session);
				return;
			}
		}

		if (grouped) {
			// Re-render just the open turn. It already contains the new items and
			// its header counts have changed, so replacing it in one step beats
			// appending and then patching the header. Bounded by one turn's size,
			// not the whole feed.
			const lastTurn = turns[turns.length - 1];
			const turnEl = feedEl.querySelector(".sv-turn:last-child");
			if (!turnEl) {
				this.renderActivityTab(contentEl, session);
				return;
			}
			const tempDiv = document.createElement("div");
			tempDiv.innerHTML = this.renderTurn(
				lastTurn,
				activities.length - lastTurn.items.length,
			);
			const fresh = tempDiv.firstElementChild;
			if (fresh) turnEl.replaceWith(fresh);
			newActivities.forEach((a) => this._renderedActivityIds.add(a.id));
		} else {
			// Flat feed: append the new items with the slide-in animation.
			const startIdx = this._lastActivityCount;
			newActivities.forEach((activity, i) => {
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = this.renderActivityItem(activity, startIdx + i);
				const newEl = tempDiv.firstElementChild;
				if (newEl) {
					newEl.classList.add("sv-new-item");
					feedEl.appendChild(newEl);
					this._renderedActivityIds.add(activity.id);
				}
			});
		}

		this._lastActivityCount = activities.length;

		// Appended items need no wiring - the detail pane's delegated handler
		// already covers them.

		// Auto-scroll to bottom if enabled
		if (State.sessionView.autoScroll) {
			contentEl.scrollTop = contentEl.scrollHeight;
		}
	},


	/**
	 * Update status of running tools without full re-render
	 * @param {HTMLElement} feedEl
	 * @param {Array} activities
	 */
	updateRunningTools(feedEl, activities) {
		// Find all running tool bubbles
		const runningTools = feedEl.querySelectorAll(".sv-bubble.sv-tool.running");

		runningTools.forEach((toolEl) => {
			const itemId = toolEl.dataset.itemId;
			if (!itemId) return;

			// Match on the activity's stable id. data-item-id holds that id (a
			// backend log UUID), never an array index. The previous code parsed
			// it as one, which failed in two different ways: for an id starting
			// with a letter parseInt gives NaN and the lookup silently misses,
			// but for one starting with digits - 60% of real log ids, measured -
			// it yields an arbitrary small integer, and the lookup can match a
			// DIFFERENT activity, rendering another tool's content into this
			// bubble. Identity matching removes both.
			const idx = activities.findIndex(
				(a) => a.type === "tool_call" && a.id === itemId,
			);
			if (idx === -1) return;

			const activity = activities[idx];
			if (activity.data?.status && activity.data.status !== "running") {
				// Tool completed - update the element in place
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = this.renderActivityItem(activity, idx);
				const newEl = tempDiv.firstElementChild;

				if (newEl) {
					// Safe to swap: handlers are delegated on the detail pane, so
					// the replacement is live without rebinding anything.
					toolEl.replaceWith(newEl);
				}
			}
		});
	},


	/**
	 * Group a flat activity list into user turns.
	 *
	 * Exact when items carry promptId, which the CLI supplies on every event
	 * except SessionStart. Sessions logged before promptId was captured have
	 * none, so those fall back to segmenting on user_prompt boundaries - an
	 * approximation, and a poor one on a long session (the largest local session
	 * has 361 tool events against 1 recorded prompt), but better than presenting
	 * historical data as one undifferentiated wall.
	 *
	 * @param {Array} activities in timestamp order
	 * @returns {Array<{key: string, promptId: string|null, prompt: string, items: Array, startTime: string, endTime: string}>}
	 */
	groupIntoTurns(activities) {
		const turns = [];
		const byPromptId = new Map();
		let open = null;

		const startTurn = (promptId) => {
			const turn = {
				key: promptId || `t${turns.length}`,
				promptId: promptId || null,
				prompt: "",
				items: [],
				startTime: "",
				endTime: "",
			};
			turns.push(turn);
			if (promptId) byPromptId.set(promptId, turn);
			return turn;
		};

		for (const activity of activities) {
			const promptId = activity.data?.promptId || null;
			let turn;

			if (promptId) {
				turn = byPromptId.get(promptId) || startTurn(promptId);
			} else if (activity.type === "user_prompt" || !open) {
				turn = startTurn(null);
			} else {
				turn = open;
			}

			if (activity.type === "user_prompt" && !turn.prompt) {
				turn.prompt = String(activity.data?.prompt || "");
			}
			if (!turn.startTime) turn.startTime = activity.timestamp;
			turn.endTime = activity.timestamp;
			turn.items.push(activity);
			open = turn;
		}

		return turns;
	},


	/**
	 * Counts for a turn's header
	 * @param {Object} turn
	 * @returns {{tools: number, errors: number, files: number}}
	 */
	turnStats(turn) {
		let tools = 0;
		let errors = 0;
		const files = new Set();

		for (const item of turn.items) {
			if (item.type !== "tool_call") continue;
			tools++;
			const status = item.data?.status;
			if (status === "failed" || status === "error") errors++;
			if (item.data?.file) files.add(item.data.file);
		}

		return { tools, errors, files: files.size };
	},


	/**
	 * Render one collapsible turn
	 * @param {Object} turn
	 * @param {number} startIdx index of the turn's first item in the flat list
	 * @returns {string}
	 */
	renderTurn(turn, startIdx) {
		const collapsed = this._collapsedTurns.has(turn.key);
		const stats = this.turnStats(turn);
		const label = turn.prompt
			? turn.prompt.replace(/\s+/g, " ").slice(0, 120)
			: "Activity before the first recorded prompt";

		return `
      <div class="sv-turn ${collapsed ? "collapsed" : ""}" data-turn-key="${Utils.escapeHtml(turn.key)}">
        <div class="sv-turn-header" data-turn-key="${Utils.escapeHtml(turn.key)}">
          <span class="sv-turn-caret">${collapsed ? "▶" : "▼"}</span>
          <span class="sv-turn-label" title="${Utils.escapeHtml(label)}">${Utils.escapeHtml(label)}</span>
          <span class="sv-turn-stats">
            <span>${stats.tools} tool${stats.tools === 1 ? "" : "s"}</span>
            ${stats.files > 0 ? `<span>${stats.files} file${stats.files === 1 ? "" : "s"}</span>` : ""}
            ${stats.errors > 0 ? `<span class="sv-turn-errors">${stats.errors} error${stats.errors === 1 ? "" : "s"}</span>` : ""}
            <span>${Utils.formatDuration(turn.startTime, turn.endTime)}</span>
          </span>
        </div>
        <div class="sv-turn-body">
          ${turn.items.map((item, i) => this.renderActivityItem(item, startIdx + i)).join("")}
        </div>
      </div>
    `;
	},


	/**
	 * Collapse every turn but the most recent, once per session. Seeding only
	 * once matters: re-seeding on each poll would undo the user's expansions
	 * every two seconds.
	 * @param {Array} turns
	 * @param {string} sessionId
	 */
	seedTurnCollapse(turns, sessionId) {
		if (this._turnsSeededFor === sessionId) return;
		this._turnsSeededFor = sessionId;
		this._collapsedTurns.clear();
		turns.slice(0, -1).forEach((turn) => this._collapsedTurns.add(turn.key));
	},


	/**
	 * Toggle a turn open or closed
	 * @param {string} key
	 */
	toggleTurn(key) {
		if (!key) return;
		if (this._collapsedTurns.has(key)) {
			this._collapsedTurns.delete(key);
		} else {
			this._collapsedTurns.add(key);
		}

		const el = document.querySelector(
			`.sv-turn[data-turn-key="${CSS.escape(key)}"]`,
		);
		if (!el) {
			this.renderTabContent();
			return;
		}
		const collapsed = this._collapsedTurns.has(key);
		el.classList.toggle("collapsed", collapsed);
		const caret = el.querySelector(".sv-turn-caret");
		if (caret) caret.textContent = collapsed ? "▶" : "▼";
	},


	/**
	 * Build activity feed from session data
	 * Uses sessionActivity from backend as primary source for activity items
	 * @param {Object} session
	 * @returns {Array}
	 */
	buildActivityFeed(session) {
		const activities = [];
		const seenIds = new Set();
		const { sessionActivity } = State.sessionView;

		// Use sessionActivity from backend as primary source
		// (already includes user_prompt, ai_response, tool_call, etc.)
		if (sessionActivity && sessionActivity.length > 0) {
			sessionActivity.forEach((raw) => {
				const activity = this.normalizeActivity(raw);
				if (!activity) return;
				const activityId = this.generateActivityId(activity, activity.type);
				if (!seenIds.has(activityId)) {
					seenIds.add(activityId);
					activities.push({ ...activity, id: activityId });
				}
			});
		}

		// Add tool executions from session as fallback
		// (in case they're not in sessionActivity yet)
		if (session.toolExecutions) {
			session.toolExecutions.forEach((tool) => {
				const activityId = this.generateActivityId(tool, "tool_call");
				if (!seenIds.has(activityId)) {
					seenIds.add(activityId);
					activities.push({
						id: activityId,
						type: "tool_call",
						timestamp: tool.startTime,
						data: tool,
					});
				}
			});
		}

		// Sort by timestamp
		activities.sort((a, b) => {
			const timeA = new Date(a.timestamp || 0).getTime();
			const timeB = new Date(b.timestamp || 0).getTime();
			return timeA - timeB;
		});

		return activities;
	},
};

window.ActivityFeedMixin = ActivityFeedMixin;
