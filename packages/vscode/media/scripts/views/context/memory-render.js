/**
 * Context view: pure renderers.
 *
 * Everything here takes data and returns HTML. No DOM reads, no state, so it is
 * unit-testable and is where the decisions that matter actually live:
 *
 *  - an orphan is shown with the remedy that fits its REASON, not one warning
 *    for two different problems
 *  - an inferred type is labelled as inferred, never presented as declared
 *  - a refusal renders the backend's own words, never a paraphrase
 */

const ContextRenderMixin = {
	/**
	 * A project row for the sidebar.
	 * @param {Object} project MemoryProject
	 * @param {boolean} selected
	 * @returns {string}
	 */
	renderProjectRow(project, selected) {
		const orphans = (project.files || []).filter((f) => f.orphaned).length;
		const label = this.projectLabel(project);

		return `
      <div class="ctx-project ${selected ? "selected" : ""}" data-memory-dir="${Utils.escapeHtml(project.memoryDir)}">
        <div class="ctx-project-name" title="${Utils.escapeHtml(project.slug)}">${Utils.escapeHtml(label)}</div>
        <div class="ctx-project-meta">
          <span>${(project.files || []).length} file${(project.files || []).length === 1 ? "" : "s"}</span>
          <span>${this.formatBytes(project.totalSize || 0)}</span>
          ${orphans > 0 ? `<span class="ctx-orphan-count" title="Never loaded by name">${orphans} orphaned</span>` : ""}
          ${project.hasIndex ? "" : '<span class="ctx-no-index" title="No MEMORY.md">no index</span>'}
        </div>
      </div>
    `;
	},

	/**
	 * Human label for a project.
	 *
	 * The slug is a path with separators flattened to dashes, which is why two
	 * different paths can produce one slug; prefer the resolved workspace path
	 * when the backend could work it out.
	 * @param {Object} project
	 * @returns {string}
	 */
	projectLabel(project) {
		if (project.workspacePath) {
			const parts = String(project.workspacePath).split("/").filter(Boolean);
			if (parts.length) return parts[parts.length - 1];
		}
		const slug = String(project.slug || "");
		const tail = slug.split("-").filter(Boolean).pop();
		return tail || slug || "unknown";
	},

	/**
	 * A file row.
	 * @param {Object} file MemoryFile
	 * @param {boolean} selected
	 * @returns {string}
	 */
	renderFileRow(file, selected) {
		return `
      <div class="ctx-file ${selected ? "selected" : ""} ${file.orphaned ? "orphaned" : ""}" data-file-name="${Utils.escapeHtml(file.fileName)}">
        <div class="ctx-file-head">
          <span class="ctx-file-name">${Utils.escapeHtml(file.name || file.fileName)}</span>
          ${this.renderTypeBadge(file)}
        </div>
        ${file.description ? `<div class="ctx-file-desc">${Utils.escapeHtml(file.description)}</div>` : ""}
        <div class="ctx-file-meta">
          <span>${this.formatBytes(file.size || 0)}</span>
          <span>${Utils.formatDate(file.modified)}</span>
          ${file.orphaned ? '<span class="ctx-orphan-flag">orphaned</span>' : ""}
        </div>
      </div>
    `;
	},

	/**
	 * The type badge.
	 *
	 * A declared type and an inferred one are rendered differently on purpose: a
	 * type guessed from a filename is a hint, and showing it as though the file
	 * declares it would mislead anyone about to edit that file's frontmatter.
	 * @param {Object} file
	 * @returns {string}
	 */
	renderTypeBadge(file) {
		if (file.type) {
			return `<span class="ctx-type ${file.type}">${Utils.escapeHtml(file.type)}</span>`;
		}
		if (file.inferredType) {
			return `<span class="ctx-type inferred ${file.inferredType}" title="Inferred from the file name; the file declares no type">${Utils.escapeHtml(file.inferredType)} (inferred)</span>`;
		}
		return '<span class="ctx-type untyped" title="The file declares no type">(untyped)</span>';
	},

	/**
	 * The orphan notice, whose remedy depends on WHY the file is unreferenced.
	 *
	 * `indexState` distinguishes the two, and they need different answers: a file
	 * missing from an existing index is one click from fixed, whereas a project
	 * with no MEMORY.md at all reports every file as orphaned, and telling
	 * someone to index thirty files individually is noise. There the answer is
	 * to start an index.
	 * @param {Object} file
	 * @returns {string}
	 */
	renderOrphanNotice(file) {
		if (!file.orphaned) return "";

		if (file.indexState === "no-index") {
			return `
        <div class="ctx-notice ctx-notice-orphan">
          This project has no <code>MEMORY.md</code>, so nothing in it is loaded by
          name — not just this file.
          <button class="btn btn-xs ctx-create-index">Create the index</button>
        </div>
      `;
		}

		return `
      <div class="ctx-notice ctx-notice-orphan">
        Nothing in <code>MEMORY.md</code> references this file, so it is never
        loaded by name.
        <button class="btn btn-xs btn-success ctx-add-to-index" data-file-name="${Utils.escapeHtml(file.fileName)}">Add to index</button>
      </div>
    `;
	},

	/**
	 * A file's detail pane.
	 * @param {Object} file
	 * @param {Object} [origin] resolved origin session, when one is held
	 * @returns {string}
	 */
	renderFileDetail(file, origin) {
		if (!file) {
			return `
        <div class="empty-state">
          <div class="empty-state-title">Select a memory file</div>
          <div class="empty-state-description">Its frontmatter and body appear here</div>
        </div>
      `;
		}

		return `
      <div class="ctx-detail">
        <div class="ctx-detail-head">
          <h3>${Utils.escapeHtml(file.name || file.fileName)}</h3>
          ${this.renderTypeBadge(file)}
          ${this.renderAuthorship(file)}
        </div>
        ${this.renderOrphanNotice(file)}
        ${file.hasFrontmatter ? "" : '<div class="ctx-notice">This file has no frontmatter. It still loads; its name and description come from the file name.</div>'}
        ${this.renderOriginLine(file, origin)}
        <div class="ctx-detail-body">${this.renderBody(file.body || "")}</div>
      </div>
    `;
	},

	/**
	 * Who wrote the file, which decides what may be done to it.
	 * @param {Object} file
	 * @returns {string}
	 */
	renderAuthorship(file) {
		return file.source === "inspector-hook"
			? '<span class="ctx-author generated" title="Written by Inspector Hook; safe to regenerate">generated</span>'
			: '<span class="ctx-author yours" title="Written by you; nothing regenerates this">yours</span>';
	},

	/**
	 * Provenance, and only when it can be honoured.
	 *
	 * Memory outlives the sessions that produced it: retention deletes sessions
	 * while memory persists, so most origin ids no longer resolve. Rendering a
	 * link that mostly leads nowhere would be worse than none, but the id is
	 * still a true statement of origin — so it is shown as text when the session
	 * is gone, and as a link only when it is actually held.
	 * @param {Object} file
	 * @param {Object} [origin]
	 * @returns {string}
	 */
	renderOriginLine(file, origin) {
		const id = this.originSessionId(file);
		if (!id) return "";

		if (origin) {
			return `
        <div class="ctx-origin">
          From session
          <button class="ctx-origin-link" data-session-id="${Utils.escapeHtml(id)}">${Utils.escapeHtml(origin.name || id.slice(0, 8))}</button>
        </div>
      `;
		}
		return `
      <div class="ctx-origin muted" title="${Utils.escapeHtml(id)}">
        From session ${Utils.escapeHtml(id.slice(0, 8))} — no longer retained
      </div>
    `;
	},

	/**
	 * The origin session id, which lives in frontmatter the parser does not
	 * surface as a field.
	 * @param {Object} file
	 * @returns {string}
	 */
	originSessionId(file) {
		if (file.originSessionId) return String(file.originSessionId);
		const match = /originSessionId:\s*(\S+)/.exec(file.rawFrontmatter || "");
		return match ? match[1] : "";
	},

	/**
	 * Render a memory body.
	 *
	 * `[[wiki-links]]` become navigation. Everything else is escaped and
	 * line-broken rather than parsed as markdown: rendering arbitrary markdown
	 * would mean parsing untrusted-ish text into HTML for no gain here.
	 * @param {string} body
	 * @returns {string}
	 */
	renderBody(body) {
		const escaped = Utils.escapeHtml(body);
		return escaped.replace(
			/\[\[([^\]]+)\]\]/g,
			(_m, name) =>
				`<button class="ctx-wikilink" data-link="${name}">${name}</button>`,
		);
	},

	/**
	 * The index, rendered as the document it is.
	 *
	 * MEMORY.md is not always a list of entries: in a real corpus it interleaves
	 * index links with headings and free-form prose that is content in its own
	 * right. Rendering it as a table of links would silently drop that prose, so
	 * the document is shown as written and the links are made navigable in place.
	 * @param {string} indexText
	 * @param {Object} project
	 * @returns {string}
	 */
	renderIndex(indexText, project) {
		if (!project?.hasIndex) {
			return `
        <div class="ctx-notice">
          No <code>MEMORY.md</code> in this project, so none of its files are
          loaded by name.
        </div>
      `;
		}

		const linked = Utils.escapeHtml(indexText || "").replace(
			/\[([^\]]+)\]\(([^)]+\.md)\)/g,
			(_m, title, file) =>
				`<button class="ctx-index-link" data-file-name="${file}">${title}</button>`,
		);

		return `
      <div class="ctx-index">
        <div class="ctx-index-meta">${this.renderIndexBudget(project)}</div>
        <div class="ctx-index-body">${linked}</div>
      </div>
    `;
	},

	/**
	 * Index size against the load budget.
	 *
	 * Reporting only: nothing truncates the user's file. Past the budget Claude
	 * stops reading the tail, which is worth saying without dressing it as an
	 * error nobody in this corpus is near.
	 * @param {Object} project
	 * @returns {string}
	 */
	renderIndexBudget(project) {
		const lines = project.indexLines || 0;
		const bytes = project.indexBytes || 0;
		const over = lines > 200 || bytes > 25 * 1024;
		return `<span class="${over ? "ctx-budget-over" : "ctx-budget"}">${lines} lines · ${this.formatBytes(bytes)}${over ? " — past the point where the tail stops being read" : ""}</span>`;
	},

	/**
	 * A refusal from the backend, in its own words.
	 *
	 * The reasons are written for people and name the specific file and cause;
	 * a paraphrase here would lose exactly the detail that makes them actionable.
	 * @param {Object} result
	 * @returns {string}
	 */
	renderRefusal(result) {
		if (!result || result.written || result.deleted || result.indexed) return "";
		const reason = result.reason || "The action was refused.";
		return `<div class="ctx-notice ctx-notice-refused">${Utils.escapeHtml(reason)}</div>`;
	},

	/**
	 * @param {number} bytes
	 * @returns {string}
	 */
	formatBytes(bytes) {
		if (!bytes) return "0 B";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	},
};

window.ContextRenderMixin = ContextRenderMixin;
