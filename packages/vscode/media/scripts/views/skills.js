/**
 * Skills view (M8) — what is installed against what actually fires.
 *
 * ## The headline this view exists to show
 *
 * **3 of 22 installed skills have ever been chosen.** Nineteen load their
 * description into every session's context and have never been picked once.
 * Eight of the twenty-two have no usable frontmatter at all, so Claude has
 * nothing to match against and structurally cannot choose them — that is a
 * defect, and it sorts to the top.
 *
 * ## Every count states where it came from
 *
 * The plan said "1 of 22", measured from our own logs after M4's retention had
 * pruned them. The transcripts say 3. So the footer names the number of
 * transcripts scanned, and if that number is 0 the view says "not measured"
 * rather than showing a confident zero — the same rule the Quality view
 * follows for tools that did not run.
 *
 * ## Why Archive and not a toggle
 *
 * `settings.json` has no skills key. A Disable switch would write something
 * the platform never reads, which is the inert-fix failure this branch keeps
 * finding. Archive moves the directory into our store and Restore moves it
 * back, and the button says which.
 */

const SkillsView = {
	_unsubscribers: [],

	init() {
		// Build the shell FIRST -- the router calls init() and never render(),
		// so a view that only subscribes here keeps its static fallback forever.
		this.render();

		this._unsubscribers.push(
			State.subscribe("skillsView", (next, prev) => {
				const p = prev || {};
				if (
					next.skills !== p.skills ||
					next.servers !== p.servers ||
					next.archived !== p.archived ||
					next.summary !== p.summary ||
					next.loading !== p.loading ||
					next.error !== p.error ||
					next.filter !== p.filter ||
					next.tab !== p.tab ||
					next.selected !== p.selected ||
					next.busyId !== p.busyId ||
					next.actionError !== p.actionError
				) {
					this.renderList();
				}
				if (
					next.file !== p.file ||
					next.fileLoading !== p.fileLoading ||
					next.selected !== p.selected ||
					next.tab !== p.tab
				) {
					this.renderDetail();
				}
			}),
		);

		const v = State.skillsView || {};
		if (!v.skills || v.skills.length === 0) {
			State.update("skillsView", { ...v, loading: true });
			API.skillsOverview(false);
		}
	},

	cleanup() {
		for (const unsub of this._unsubscribers) unsub();
		this._unsubscribers = [];
	},

	render() {
		const container = document.getElementById("skills-view");
		if (!container) return;
		container.innerHTML = `
			<div class="sk-layout">
				<div class="sk-main">
					<div class="sk-head">
						<div class="sk-tabs" role="tablist">
							<button class="sk-tab" data-tab="skills" role="tab">Skills</button>
							<button class="sk-tab" data-tab="tools" role="tab">Tools</button>
						</div>
						<button id="sk-refresh" class="sk-link" title="Recount across every transcript">recount</button>
					</div>
					<div id="sk-summary" class="sk-summary"></div>
					<div id="sk-filters" class="sk-filters"></div>
					<div id="sk-list" class="sk-list"></div>
					<div id="sk-source" class="sk-source"></div>
				</div>
				<div id="sk-detail" class="sk-detail"></div>
			</div>
		`;

		const refresh = document.getElementById("sk-refresh");
		if (refresh) {
			refresh.addEventListener("click", () => {
				State.update("skillsView", {
					...State.skillsView,
					loading: true,
					actionError: null,
				});
				API.skillsOverview(true);
			});
		}
		for (const el of document.querySelectorAll(".sk-tab")) {
			el.addEventListener("click", () => {
				State.update("skillsView", {
					...State.skillsView,
					tab: el.dataset.tab,
					selected: null,
					file: null,
				});
			});
		}

		this.renderList();
		this.renderDetail();
	},

	renderList() {
		const v = State.skillsView || {};
		for (const el of document.querySelectorAll(".sk-tab")) {
			el.classList.toggle("active", el.dataset.tab === (v.tab || "skills"));
			el.setAttribute(
				"aria-selected",
				el.dataset.tab === (v.tab || "skills") ? "true" : "false",
			);
		}
		this.renderSummary();
		this.renderFilters();
		this.renderSource();

		const host = document.getElementById("sk-list");
		if (!host) return;

		if (v.loading) {
			host.innerHTML = `<div class="sk-dim">Counting invocations across every transcript…</div>`;
			return;
		}
		if (v.error) {
			host.innerHTML = `<div class="sk-error">${Utils.escapeHtml(v.error)}</div>`;
			return;
		}
		host.innerHTML =
			(v.tab || "skills") === "tools" ? this.toolsHtml(v) : this.skillsHtml(v);
		this._bindRows();
	},

	/** The filter applied to the skill list. */
	matches(skill, filter) {
		if (filter === "unused") return skill.usage.invocations === 0;
		if (filter === "used") return skill.usage.invocations > 0;
		if (filter === "invalid") return !skill.frontmatterValid;
		return true;
	},

	skillsHtml(v) {
		const filter = v.filter || "all";
		const skills = (v.skills || []).filter((s) => this.matches(s, filter));
		if (skills.length === 0) {
			return `<div class="sk-dim">No skills match this filter.</div>`;
		}
		const archived = new Set((v.archived || []).map((a) => a.id));
		return skills.map((s) => this.skillRow(s, v, archived)).join("");
	},

	skillRow(s, v, archived) {
		const used = s.usage.invocations > 0;
		// A skill with no frontmatter is not merely unpopular -- Claude has no
		// description to match, so it can never be chosen. Said plainly.
		const badge = !s.frontmatterValid
			? `<span class="sk-warn" title="No usable frontmatter: Claude has no description to match, so this skill can never be chosen">no frontmatter</span>`
			: used
				? `<span class="sk-ok">${s.usage.invocations}×</span>`
				: `<span class="sk-dim" title="Never chosen in any transcript we can read">never used</span>`;
		const where = used
			? `<span class="sk-dim">${s.usage.distinctProjects} project${s.usage.distinctProjects === 1 ? "" : "s"} · last ${Utils.escapeHtml((s.usage.lastUsed || "").slice(0, 10))}</span>`
			: "";
		const source =
			s.source === "installed"
				? ""
				: `<span class="sk-src sk-src-${s.source}" title="${
						s.source === "builtin"
							? "Ships with Claude Code — not one of your installed skills"
							: s.source === "plugin"
								? `From the plugin ${Utils.escapeHtml(s.plugin || "")}`
								: "Scoped to one project"
					}">${s.source}</span>`;
		const description = s.frontmatter.description
			? `<div class="sk-desc">${Utils.escapeHtml(s.frontmatter.description)}</div>`
			: "";

		return `
			<div class="sk-row${v.selected === s.id ? " selected" : ""}${s.frontmatterValid ? "" : " invalid"}" data-id="${Utils.escapeHtml(s.id)}">
				<div class="sk-row-top">
					<span class="sk-name">${Utils.escapeHtml(s.frontmatter.name || s.id)}</span>
					${source}
					${badge}
				</div>
				${description}
				<div class="sk-row-meta">
					${where}
					${archived.has(s.id) ? `<span class="sk-dim">archived</span>` : ""}
				</div>
			</div>`;
	},

	toolsHtml(v) {
		const servers = v.servers || [];
		if (servers.length === 0) {
			return `<div class="sk-dim">No MCP servers configured or observed.</div>`;
		}
		return servers.map((s) => this.serverRow(s, v)).join("");
	},

	serverRow(s, v) {
		// Both directions are findings. A configured server that never fired is
		// the same as an unused skill; an observed server that is not configured
		// means ~/.claude.json is not the inventory it looks like.
		const badge = s.usage.invocations
			? `<span class="sk-ok">${s.usage.invocations} call${s.usage.invocations === 1 ? "" : "s"}</span>`
			: `<span class="sk-dim" title="Configured but never called in any transcript we can read">never called</span>`;
		const config = s.configured
			? `<span class="sk-dim">${Utils.escapeHtml(s.type || "stdio")}</span>`
			: `<span class="sk-warn" title="Observed in the transcripts but absent from ~/.claude.json">not in config</span>`;
		const tools = (s.tools || [])
			.slice(0, 6)
			.map(
				(t) =>
					`<span class="sk-tool">${Utils.escapeHtml(t.tool.split("__").slice(2).join("__"))} <em>${t.invocations}</em></span>`,
			)
			.join("");
		const more =
			(s.tools || []).length > 6
				? `<span class="sk-dim">+${s.tools.length - 6} more</span>`
				: "";

		return `
			<div class="sk-row${v.selected === s.name ? " selected" : ""}" data-server="${Utils.escapeHtml(s.name)}">
				<div class="sk-row-top">
					<span class="sk-name">${Utils.escapeHtml(s.name)}</span>
					${config}
					${badge}
				</div>
				${s.command ? `<div class="sk-desc sk-mono">${Utils.escapeHtml([s.command, ...(s.args || [])].join(" "))}</div>` : ""}
				<div class="sk-tools">${tools}${more}</div>
			</div>`;
	},

	renderSummary() {
		const host = document.getElementById("sk-summary");
		if (!host) return;
		const v = State.skillsView || {};
		const s = v.summary;
		if (!s) {
			host.innerHTML = "";
			return;
		}
		if ((v.tab || "skills") === "tools") {
			// Total is every server we know of, configured or merely observed --
			// the observed ones are the point: claude-in-chrome is 548 of the 684
			// calls and is in no config file.
			const total = (v.servers || []).length;
			const unconfigured = total - s.serversConfigured;
			host.innerHTML = `
				<span class="sk-stat"><strong>${s.serversObserved}</strong> of <strong>${total}</strong> servers have ever been called</span>
				<span class="sk-stat">${s.mcpInvocations} invocations</span>
				${unconfigured ? `<span class="sk-stat sk-warn" title="Seen in the transcripts but absent from ~/.claude.json">${unconfigured} not in config</span>` : ""}`;
			return;
		}
		host.innerHTML = `
			<span class="sk-stat"><strong>${s.installedUsed}</strong> of <strong>${s.installed}</strong> installed skills have ever fired</span>
			${s.invalid ? `<span class="sk-stat sk-warn">${s.invalid} with no frontmatter</span>` : ""}
			${s.builtinUsed ? `<span class="sk-stat sk-dim" title="Skills that fired but are not yours — they ship with Claude Code">${s.builtinUsed} built-in also used</span>` : ""}
			${s.pluginSkills ? `<span class="sk-stat sk-dim">${s.pluginSkills} from plugins</span>` : ""}`;
	},

	renderFilters() {
		const host = document.getElementById("sk-filters");
		if (!host) return;
		const v = State.skillsView || {};
		if ((v.tab || "skills") === "tools") {
			host.innerHTML = "";
			return;
		}
		const current = v.filter || "all";
		const options = [
			["all", "All"],
			["unused", "Never used"],
			["used", "Used"],
			["invalid", "No frontmatter"],
		];
		host.innerHTML = options
			.map(
				([key, label]) =>
					`<button class="sk-filter${current === key ? " active" : ""}" data-filter="${key}">${label}</button>`,
			)
			.join("");
		for (const el of document.querySelectorAll(".sk-filter")) {
			el.addEventListener("click", () => {
				State.update("skillsView", {
					...State.skillsView,
					filter: el.dataset.filter,
				});
			});
		}
	},

	renderSource() {
		const host = document.getElementById("sk-source");
		if (!host) return;
		const v = State.skillsView || {};
		const src = v.source;
		if (!src) {
			host.innerHTML = "";
			return;
		}
		// A count with no transcripts behind it is not a zero, it is an absence,
		// and it must never render as "never used".
		if (!src.transcriptsScanned) {
			host.innerHTML = `<span class="sk-warn">Not measured — no transcript was read${src.error ? `: ${Utils.escapeHtml(src.error)}` : ""}. The counts above are unknown, not zero.</span>`;
			return;
		}
		host.innerHTML = `<span class="sk-dim">Counted from ${src.transcriptsScanned} transcripts in ${(src.scanMs / 1000).toFixed(1)}s${src.error ? ` · <span class="sk-warn">${Utils.escapeHtml(src.error)}</span>` : ""}</span>`;
	},

	_bindRows() {
		for (const el of document.querySelectorAll("#sk-list .sk-row[data-id]")) {
			el.addEventListener("click", () => {
				const id = el.dataset.id;
				State.update("skillsView", {
					...State.skillsView,
					selected: id,
					file: null,
					fileLoading: true,
					actionError: null,
				});
				API.skillsReadFile(id);
			});
		}
		for (const el of document.querySelectorAll(
			"#sk-list .sk-row[data-server]",
		)) {
			el.addEventListener("click", () => {
				State.update("skillsView", {
					...State.skillsView,
					selected: el.dataset.server,
				});
			});
		}
	},

	renderDetail() {
		const host = document.getElementById("sk-detail");
		if (!host) return;
		const v = State.skillsView || {};

		if ((v.tab || "skills") === "tools") {
			host.innerHTML = this.serverDetailHtml(v);
			return;
		}
		if (!v.selected) {
			host.innerHTML = `<div class="sk-dim sk-pad">Select a skill to read its SKILL.md.</div>`;
			return;
		}
		const skill = (v.skills || []).find((s) => s.id === v.selected);
		if (!skill) {
			host.innerHTML = `<div class="sk-dim sk-pad">That skill is no longer listed.</div>`;
			return;
		}

		const archived = (v.archived || []).some((a) => a.id === skill.id);
		host.innerHTML = `
			<div class="sk-detail-head">
				<div>
					<div class="sk-detail-name">${Utils.escapeHtml(skill.frontmatter.name || skill.id)}</div>
					<div class="sk-dim sk-mono">${Utils.escapeHtml(skill.path || "not on disk")}</div>
				</div>
				${this.actionHtml(skill, archived, v)}
			</div>
			${this.factsHtml(skill)}
			${v.actionError ? `<div class="sk-error">${Utils.escapeHtml(v.actionError)}</div>` : ""}
			<div class="sk-file">${this.fileHtml(v)}</div>`;

		const action = document.getElementById("sk-archive");
		if (action) {
			action.addEventListener("click", () => {
				State.update("skillsView", {
					...State.skillsView,
					busyId: skill.id,
					actionError: null,
				});
				API.skillsSetArchived(skill.id, !archived);
			});
		}
		const open = document.getElementById("sk-open");
		if (open && skill.skillFile) {
			open.addEventListener("click", () => API.openFile(skill.skillFile));
		}
	},

	actionHtml(skill, archived, v) {
		// Only a skill of ours, on disk, can be moved. A plugin would restore
		// itself on the plugin's next update, and a built-in is not on disk.
		if (skill.source !== "installed" && skill.source !== "project") {
			return `<span class="sk-dim" title="Not yours to move — ${skill.source === "builtin" ? "this ships with Claude Code" : "the plugin owns it"}">read-only</span>`;
		}
		const busy = v.busyId === skill.id;
		return `
			<div class="sk-actions">
				${skill.skillFile ? `<button id="sk-open" class="sk-link">open file</button>` : ""}
				<button id="sk-archive" class="sk-btn"${busy ? " disabled" : ""} title="${
					archived
						? "Move the directory back to where it came from"
						: "Move the directory into the Inspector Hook store. Reversible — this is not a disable switch, because the platform has none."
				}">${busy ? "working…" : archived ? "Restore" : "Archive"}</button>
			</div>`;
	},

	factsHtml(skill) {
		const rows = [
			[
				"Invocations",
				skill.usage.invocations
					? `${skill.usage.invocations} across ${skill.usage.distinctSessions} session${skill.usage.distinctSessions === 1 ? "" : "s"} and ${skill.usage.distinctProjects} project${skill.usage.distinctProjects === 1 ? "" : "s"}`
					: "never",
			],
			["Last used", skill.usage.lastUsed || "—"],
			[
				"Source",
				skill.plugin ? `${skill.source} (${skill.plugin})` : skill.source,
			],
			[
				"Frontmatter",
				skill.frontmatterValid
					? [
							skill.frontmatter.name ? "name" : null,
							skill.frontmatter.description ? "description" : null,
							skill.frontmatter.allowedTools ? "allowed-tools" : null,
							skill.frontmatter.trigger ? "trigger" : null,
						]
							.filter(Boolean)
							.join(", ")
					: "none — this skill can never be chosen",
			],
			[
				"Tree",
				`${(skill.bytes / 1024).toFixed(1)} KB · ${skill.extraFiles} supporting file${skill.extraFiles === 1 ? "" : "s"}${skill.subdirectories.length ? ` · ${skill.subdirectories.join(", ")}` : ""}`,
			],
		];
		if (skill.frontmatter.trigger) {
			rows.push(["Trigger", skill.frontmatter.trigger]);
		}
		if (skill.frontmatter.allowedTools) {
			rows.push(["Allowed tools", skill.frontmatter.allowedTools]);
		}
		return `<dl class="sk-facts">${rows
			.map(
				([k, val]) =>
					`<dt>${Utils.escapeHtml(k)}</dt><dd>${Utils.escapeHtml(String(val))}</dd>`,
			)
			.join("")}</dl>`;
	},

	fileHtml(v) {
		if (v.fileLoading) return `<div class="sk-dim">Reading SKILL.md…</div>`;
		const file = v.file;
		if (!file) return "";
		if (file.error) {
			return `<div class="sk-error">${Utils.escapeHtml(file.error)}</div>`;
		}
		if (!file.text)
			return `<div class="sk-dim">This skill has no SKILL.md.</div>`;
		return `<pre class="sk-md">${Utils.escapeHtml(file.text)}</pre>${
			file.truncated
				? `<div class="sk-warn">Truncated — the file is ${(file.bytes / 1024).toFixed(0)} KB.</div>`
				: ""
		}`;
	},

	serverDetailHtml(v) {
		const server = (v.servers || []).find((s) => s.name === v.selected);
		if (!server) {
			return `<div class="sk-dim sk-pad">Select a server to see its tools.</div>`;
		}
		const tools = (server.tools || []).length
			? `<table class="sk-table"><thead><tr><th>Tool</th><th>Calls</th><th>Sessions</th><th>Last used</th></tr></thead><tbody>${server.tools
					.map(
						(t) =>
							`<tr><td class="sk-mono">${Utils.escapeHtml(t.tool.split("__").slice(2).join("__"))}</td><td>${t.invocations}</td><td>${t.distinctSessions}</td><td>${Utils.escapeHtml((t.lastUsed || "").slice(0, 10))}</td></tr>`,
					)
					.join("")}</tbody></table>`
			: `<div class="sk-dim">No call to this server appears in any transcript we read.</div>`;

		return `
			<div class="sk-detail-head">
				<div>
					<div class="sk-detail-name">${Utils.escapeHtml(server.name)}</div>
					<div class="sk-dim">${server.configured ? "configured in ~/.claude.json" : "observed only — absent from ~/.claude.json"}</div>
				</div>
			</div>
			${server.command ? `<div class="sk-desc sk-mono sk-pad">${Utils.escapeHtml([server.command, ...(server.args || [])].join(" "))}</div>` : ""}
			${tools}`;
	},
};

if (typeof window !== "undefined") window.SkillsView = SkillsView;

if (typeof Router !== "undefined" && Router.register) {
	Router.register("skills", SkillsView);
}
