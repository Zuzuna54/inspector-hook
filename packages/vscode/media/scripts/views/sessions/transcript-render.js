/**
 * The session's real content, and how full its context got.
 *
 * Everything else in the Sessions view is built from hook EVENTS, which are
 * metadata: the feed knows a Bash call happened and which files it touched, and
 * nothing about what was said. This renders Claude Code's own transcript — the
 * prompts, the replies, the thinking, the tool inputs and their results.
 *
 * The context figure is the headline because it is the thing that has no other
 * source: a session on this machine peaked at 987,382 tokens, 98.7% of a 1M
 * window, and nothing in the panel could say so.
 */

const TranscriptRenderMixin = {
	/**
	 * How full the context got.
	 *
	 * Peak rather than last, because the peak is where a limit or a compaction
	 * boundary would have been hit; the last turn can be far smaller after a
	 * compaction and would understate the session entirely.
	 */
	renderContextUsage(stats) {
		if (!stats || !stats.usage || !stats.usage.turns) return "";
		const u = stats.usage;
		// Inferred from the model's own reported context, not hardcoded per
		// model: the largest context actually observed is a floor for the
		// window, and rounding up to the nearest common size is a guess we do
		// not need to make. Percentages are shown against 1M only when the peak
		// makes that the obvious window.
		const window = u.peakContextTokens > 250_000 ? 1_000_000 : 200_000;
		const pct = Math.min((u.peakContextTokens / window) * 100, 100);
		const level = pct >= 80 ? "high" : pct >= 50 ? "medium" : "low";

		return `
      <div class="sv-context-usage ${level}">
        <div class="sv-usage-head">
          <span class="sv-usage-label">Context used</span>
          <span class="sv-usage-peak">${this.formatTokens(u.peakContextTokens)}</span>
          <span class="sv-usage-pct">${pct.toFixed(0)}% of ${this.formatTokens(window)}</span>
        </div>
        <div class="sv-usage-bar"><div class="sv-usage-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="sv-usage-meta">
          peak over ${u.turns} turn${u.turns === 1 ? "" : "s"}
          · last ${this.formatTokens(u.lastContextTokens)}
          · ${this.formatTokens(u.totalOutputTokens)} generated
          ${u.models.length ? `· ${Utils.escapeHtml(u.models.join(", "))}` : ""}
        </div>
      </div>
    `;
	},

	/**
	 * What the transcript holds, including what this reader did NOT understand.
	 *
	 * `unrecognised` is shown rather than hidden: Claude Code's format is
	 * documented as internal and changeable, so a format change has to surface
	 * as a number here instead of as a quietly shorter transcript.
	 */
	renderTranscriptStats(stats) {
		if (!stats) return "";
		const k = stats.byKind || {};
		const problems = [];
		if (stats.unrecognised) problems.push(`${stats.unrecognised} unrecognised`);
		if (stats.unparseable) problems.push(`${stats.unparseable} unreadable`);
		if (stats.clipped) problems.push(`${stats.clipped} clipped`);

		return `
      <div class="sv-transcript-stats">
        <span>${k.prompt || 0} prompts</span>
        <span>${k.reply || 0} replies</span>
        <span>${k.thinking || 0} thinking</span>
        <span>${k.tool_use || 0} tool calls</span>
        <span class="sv-transcript-size">${this.formatBytes(stats.bytes || 0)}</span>
        ${problems.length ? `<span class="sv-transcript-warn">${problems.join(" · ")}</span>` : ""}
      </div>
    `;
	},

	/** One transcript entry. */
	renderTranscriptEntry(entry) {
		const label =
			{
				prompt: "You",
				reply: "Claude",
				thinking: "thinking",
				tool_use: entry.toolName || "tool",
				tool_result: "result",
				system: "system",
				unknown: entry.rawType || "unknown",
			}[entry.kind] || entry.kind;

		// Clamped per entry: a single tool result can run to hundreds of
		// kilobytes, and rendering it whole would freeze the panel for one row.
		const full = entry.text || "";
		const clamped = full.length > 4000;
		const shown = clamped ? full.slice(0, 4000) : full;

		return `
      <div class="sv-tr-entry ${entry.kind}">
        <div class="sv-tr-head">
          <span class="sv-tr-kind">${Utils.escapeHtml(label)}</span>
          ${entry.timestamp ? `<span class="sv-tr-time">${Utils.formatTime(entry.timestamp)}</span>` : ""}
          ${entry.clipped ? '<span class="sv-transcript-warn">line clipped at source</span>' : ""}
        </div>
        ${shown ? `<pre class="sv-tr-body">${Utils.escapeHtml(shown)}</pre>` : ""}
        ${
					clamped
						? `<div class="sv-tr-more">${this.formatBytes(full.length - 4000)} more not shown</div>`
						: ""
				}
      </div>
    `;
	},

	/** The transcript pane. */
	renderTranscript(view) {
		if (!view) return "";
		if (view.reason) {
			return `<div class="ctx-notice">${Utils.escapeHtml(view.reason)}</div>`;
		}
		if (!view.entries || !view.entries.length) {
			return `<div class="empty-state"><div class="empty-state-title">No transcript loaded</div></div>`;
		}
		return `
      ${this.renderContextUsage(view.stats)}
      ${this.renderTranscriptStats(view.stats)}
      <div class="sv-transcript">
        ${view.entries.map((e) => this.renderTranscriptEntry(e)).join("")}
      </div>
      ${
				view.hasMore
					? `<div class="load-more">
              <button class="btn btn-secondary sv-transcript-more">
                Load more (${view.total - view.entries.length} remaining)
              </button>
            </div>`
					: ""
			}
    `;
	},

	/** @param {number} n */
	formatTokens(n) {
		if (!n) return "0";
		if (n < 1000) return String(n);
		if (n < 1_000_000) return `${(n / 1000).toFixed(0)}k`;
		return `${(n / 1_000_000).toFixed(2)}M`;
	},

	/** @param {number} bytes */
	formatBytes(bytes) {
		if (!bytes) return "0 B";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	},
};

window.TranscriptRenderMixin = TranscriptRenderMixin;
