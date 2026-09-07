/**
 * Agents view (M5) — the live agent tree.
 *
 * Shows, for every agent this core has seen: what it was asked, what it did,
 * what came back, and how long it took.
 *
 * ## Three things this view refuses to do
 *
 * **It never shows a spawn acknowledgement as a report.** Every captured spawn
 * call returned `{"status":"teammate_spawned"}` — the agent started, its
 * findings did not come back through that channel. The plan opens M5 by noting
 * six subagents whose reports never reached the parent; rendering the
 * acknowledgement under "returned" would hide precisely that.
 *
 * **It never shows a duration without saying where the number came from.**
 * `SubagentStop.durationMs` is null in 384 of 384 live events, so almost every
 * duration here is computed from observed events, and a computed span for a
 * still-running agent means "so far", not "in total".
 *
 * **It never hides an unlinked agent.** The spawn call carries no agentId and
 * the lifecycle events carry no prompt, so the two halves are matched
 * heuristically and 148 of 170 live agents match nothing. Dropping them would
 * hide most of the picture; merging them would invent one.
 */

const AgentsView = {
	_unsubscribers: [],

	init() {
		this._unsubscribers.push(
			State.subscribe("agentsView", (next, prev) => {
				const p = prev || {};
				if (
					next.agents !== p.agents ||
					next.loading !== p.loading ||
					next.error !== p.error ||
					next.selected !== p.selected ||
					next.filter !== p.filter
				) {
					this.renderList();
				}
				if (next.stats !== p.stats) this.renderStats();
			}),
		);
		this.refresh();
	},

	cleanup() {
		for (const unsub of this._unsubscribers) unsub();
		this._unsubscribers = [];
	},

	refresh() {
		State.update("agentsView", {
			...State.agentsView,
			loading: true,
			error: null,
		});
		API.agentsTree({ limit: 200 });
	},

	render() {
		const container = document.getElementById("agents-view");
		if (!container) return;
		container.innerHTML = `
			<div class="ag-header">
				<div class="ag-bar">
					<div class="ag-filters">${this._renderFilters()}</div>
					<button id="ag-refresh" class="btn">Refresh</button>
				</div>
				<div id="ag-stats"></div>
			</div>
			<div id="ag-list" class="ag-list"></div>
		`;
		const refresh = document.getElementById("ag-refresh");
		if (refresh) refresh.addEventListener("click", () => this.refresh());
		this._bindFilters();
		this.renderStats();
		this.renderList();
	},

	FILTERS: [
		["all", "All"],
		["running", "Running"],
		["worked", "Did work"],
		["unreported", "Never reported"],
	],

	_renderFilters() {
		const current = (State.agentsView || {}).filter || "all";
		return this.FILTERS.map(
			([key, label]) =>
				`<button class="ag-filter${current === key ? " active" : ""}" data-filter="${key}">${label}</button>`,
		).join("");
	},

	_bindFilters() {
		for (const btn of document.querySelectorAll(".ag-filter")) {
			btn.addEventListener("click", () => {
				State.update("agentsView", {
					...State.agentsView,
					filter: btn.dataset.filter,
				});
				for (const other of document.querySelectorAll(".ag-filter")) {
					other.classList.toggle("active", other === btn);
				}
			});
		}
	},

	renderStats() {
		const host = document.getElementById("ag-stats");
		if (!host) return;
		const s = (State.agentsView || {}).stats;
		if (!s) {
			host.innerHTML = "";
			return;
		}
		host.className = "ag-stats";
		host.innerHTML = `
			<span>${s.total} agents · ${s.running} running · ${s.totalToolCalls} tool calls</span>
			${
				s.spawnAckOnly
					? `<span class="ag-warn" title="These agents acknowledged the spawn and never returned findings through the tool call">${s.spawnAckOnly} never reported</span>`
					: ""
			}
			${
				s.unlinked
					? `<span class="ag-dim" title="No spawn call was seen for these, so what they were asked is unknown">${s.unlinked} unlinked</span>`
					: ""
			}`;
	},

	/** Agents after the active filter. */
	visible() {
		const v = State.agentsView || {};
		const agents = v.agents || [];
		switch (v.filter) {
			case "running":
				return agents.filter((a) => a.status === "running");
			case "worked":
				return agents.filter((a) => (a.toolCalls || []).length > 0);
			case "unreported":
				return agents.filter((a) => a.resultKind === "spawn-ack");
			default:
				return agents;
		}
	},

	renderList() {
		const host = document.getElementById("ag-list");
		if (!host) return;
		const v = State.agentsView || {};

		if (v.loading) {
			host.innerHTML = `<div class="ag-empty">Loading agents…</div>`;
			return;
		}
		if (v.error) {
			host.innerHTML = `<div class="ag-error"><strong>Could not load agents.</strong> ${Utils.escapeHtml(v.error)}</div>`;
			return;
		}
		const agents = this.visible();
		if (agents.length === 0) {
			host.innerHTML = `<div class="ag-empty">No agents match. Subagents appear here as soon as one runs.</div>`;
			return;
		}
		host.innerHTML = agents.map((a) => this.renderAgent(a, v)).join("");
		this._bindRows();
	},

	renderAgent(agent, v) {
		const open = v.selected && v.selected.id === agent.id;
		const label = agent.name || agent.type || agent.agentId || agent.id;
		return `
			<div class="ag-row${open ? " open" : ""}" data-id="${Utils.escapeHtml(agent.id)}">
				<div class="ag-row-head">
					<span class="ag-status ag-status-${Utils.escapeHtml(agent.status)}">${Utils.escapeHtml(agent.status)}</span>
					<span class="ag-name">${Utils.escapeHtml(label)}</span>
					${agent.type && agent.type !== label ? `<span class="ag-type">${Utils.escapeHtml(agent.type)}</span>` : ""}
					<span class="ag-meta">
						${(agent.toolCalls || []).length} calls
						${this.renderDuration(agent)}
						${this.renderResult(agent)}
						${agent.linked ? "" : `<span class="ag-dim" title="No spawn call was seen, so what this agent was asked is unknown">unlinked</span>`}
					</span>
				</div>
				${agent.description ? `<div class="ag-asked">${Utils.escapeHtml(agent.description)}</div>` : ""}
				${open ? this.renderDetail(agent) : ""}
			</div>`;
	},

	/** A duration always states its provenance, and "so far" while running. */
	renderDuration(agent) {
		if (agent.durationMs == null) {
			return `<span class="ag-dim" title="Neither the platform nor the observed events gave a usable span">no duration</span>`;
		}
		const secs = agent.durationMs / 1000;
		const text =
			secs >= 60 ? `${(secs / 60).toFixed(1)}m` : `${secs.toFixed(1)}s`;
		const running = agent.status === "running";
		const title =
			agent.durationSource === "reported"
				? "Reported by the platform"
				: "Computed from the first and last events seen for this agent";
		return `<span class="ag-dur" title="${title}">${text}${running ? " so far" : ""}</span>`;
	},

	/** The distinction the whole view exists for. */
	renderResult(agent) {
		if (agent.resultKind === "spawn-ack") {
			return `<span class="ag-warn" title="The spawn was acknowledged; the agent's findings never came back through this channel">never reported</span>`;
		}
		if (agent.resultKind === "report") {
			return `<span class="ag-ok" title="The agent returned findings">reported</span>`;
		}
		return "";
	},

	renderDetail(agent) {
		const calls = (agent.toolCalls || []).slice(-12).reverse();
		return `
			<div class="ag-detail">
				${
					agent.prompt
						? `<div class="ag-section"><div class="ag-section-title">Asked</div><pre class="ag-pre">${Utils.escapeHtml(agent.prompt)}</pre></div>`
						: `<div class="ag-section"><div class="ag-dim">No spawn call was captured for this agent, so what it was asked is unknown.</div></div>`
				}
				${
					agent.result
						? `<div class="ag-section"><div class="ag-section-title">Returned ${agent.resultKind === "spawn-ack" ? "(acknowledgement only)" : ""}</div><pre class="ag-pre">${Utils.escapeHtml(agent.result)}</pre></div>`
						: ""
				}
				<div class="ag-section">
					<div class="ag-section-title">Did (${(agent.toolCalls || []).length} calls, latest first)</div>
					${
						calls.length
							? calls
									.map(
										(c) => `<div class="ag-call">
											<span class="ag-call-tool">${Utils.escapeHtml(c.tool)}</span>
											<span class="ag-dim">${Utils.escapeHtml(c.summary || "")}</span>
										</div>`,
									)
									.join("")
							: `<div class="ag-dim">No tool calls were attributed to this agent.</div>`
					}
				</div>
			</div>`;
	},

	_bindRows() {
		for (const row of document.querySelectorAll(".ag-row")) {
			row.addEventListener("click", () => {
				const id = row.dataset.id;
				const sel = State.agentsView.selected;
				if (sel && sel.id === id) {
					State.update("agentsView", { ...State.agentsView, selected: null });
					return;
				}
				const found = (State.agentsView.agents || []).find((a) => a.id === id);
				State.update("agentsView", {
					...State.agentsView,
					selected: found || null,
				});
			});
		}
	},
};

if (typeof window !== "undefined") window.AgentsView = AgentsView;

if (typeof Router !== "undefined" && Router.register) {
	Router.register("agents", AgentsView);
}
