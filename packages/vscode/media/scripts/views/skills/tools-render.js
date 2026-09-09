/**
 * The Tools half of the Skills view: MCP servers, and whether they answer.
 *
 * Split out when skills.js crossed the package's 600-line limit. The seam is
 * real rather than arbitrary — everything here is about servers, and the two
 * panes share only the state slice.
 *
 * ## Three states, not two
 *
 * A server is `configured` (in ~/.claude.json), `observed` (it appears in the
 * transcripts), and separately `reachable` (it answered a handshake just now).
 * None implies another, and all three are measured facts here:
 * `claude-in-chrome` is observed 548 times and configured nowhere, while
 * `memory` is configured, never called, and cannot start at all because its
 * interpreter was deleted.
 *
 * **"not checked" is the default and is rendered as itself.** Reachability
 * costs a spawned process per server — one of them a browser — so nothing
 * probes on open, and an unchecked server is never drawn as either reachable
 * or broken.
 */

const SkillsToolsMixin = {
	/**
	 * Reachability, or the honest absence of it.
	 *
	 * "not checked" is a distinct state from every other, and it is the default.
	 * Rendering an unchecked server as reachable — or as unreachable — would be
	 * a claim nobody made, which is the failure this whole view is built to
	 * avoid. Nothing probes on open: it spawns real processes.
	 */
	probeBadge(name, v) {
		const probe = (v.probes || {})[name];
		if (v.probing) return `<span class="sk-dim">checking…</span>`;
		if (!probe) {
			return `<span class="sk-dim" title="Nothing has connected to this server. Use 'check reachability' — it is not checked automatically because it starts real processes.">not checked</span>`;
		}
		if (probe.status === "reachable") {
			return `<span class="sk-ok" title="Handshook in ${probe.durationMs}ms · ${Utils.escapeHtml(probe.serverName || name)} ${Utils.escapeHtml(probe.serverVersion || "")} · advertises ${(probe.advertisedTools || []).length} tools">reachable</span>`;
		}
		return `<span class="sk-bad" title="${Utils.escapeHtml(probe.error || "")}">${Utils.escapeHtml(probe.status)}</span>`;
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
					${this.probeBadge(s.name, v)}
				</div>
				${s.command ? `<div class="sk-desc sk-mono">${Utils.escapeHtml([s.command, ...(s.args || [])].join(" "))}</div>` : ""}
				<div class="sk-tools">${tools}${more}</div>
			</div>`;
	},
	toolsHtml(v) {
		const servers = v.servers || [];
		if (servers.length === 0) {
			return `<div class="sk-dim">No MCP servers configured or observed.</div>`;
		}
		return servers.map((s) => this.serverRow(s, v)).join("");
	},
	/**
	 * What a probe learned, when one has been run.
	 *
	 * The two facts worth the space: the name the server calls ITSELF, which
	 * disagrees with the config key for two of the three reachable servers
	 * here, and the tools it ADVERTISES against the ones actually called.
	 * Playwright advertises 24 and 9 have ever been used.
	 */
	probeDetailHtml(server, v) {
		const probe = (v.probes || {})[server.name];
		if (!probe) return "";
		if (probe.status !== "reachable") {
			return `<div class="sk-facts sk-pad"><dt>Reachability</dt><dd class="sk-bad">${Utils.escapeHtml(probe.status)} — ${Utils.escapeHtml(probe.error || "no reason given")}</dd></div>`;
		}
		const advertised = probe.advertisedTools || [];
		const called = new Set(
			(server.tools || []).map((t) => t.tool.split("__").slice(2).join("__")),
		);
		const never = advertised.filter((t) => !called.has(t));
		const rows = [
			[
				"Reachability",
				`handshook in ${probe.durationMs}ms · checked ${Utils.escapeHtml((probe.checkedAt || "").slice(0, 16).replace("T", " "))}`,
			],
			[
				"Calls itself",
				`${Utils.escapeHtml(probe.serverName || "—")} ${Utils.escapeHtml(probe.serverVersion || "")}${
					probe.serverName && probe.serverName !== server.name
						? ` — which is not the name it is configured under`
						: ""
				}`,
			],
			["Protocol", Utils.escapeHtml(probe.protocolVersion || "—")],
			["Advertises", `${advertised.length} tools`],
		];
		if (never.length) {
			rows.push([
				"Never called",
				`${never.length} of ${advertised.length}: ${Utils.escapeHtml(never.slice(0, 8).join(", "))}${never.length > 8 ? ", …" : ""}`,
			]);
		}
		return `<dl class="sk-facts">${rows
			.map(([k, val]) => `<dt>${Utils.escapeHtml(k)}</dt><dd>${val}</dd>`)
			.join("")}</dl>`;
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
				${this.probeBadge(server.name, v)}
			</div>
			${v.probeError ? `<div class="sk-error">${Utils.escapeHtml(v.probeError)}</div>` : ""}
			${this.probeDetailHtml(server, v)}
			${server.command ? `<div class="sk-desc sk-mono sk-pad">${Utils.escapeHtml([server.command, ...(server.args || [])].join(" "))}</div>` : ""}
			${tools}`;
	},
};

window.SkillsToolsMixin = SkillsToolsMixin;
