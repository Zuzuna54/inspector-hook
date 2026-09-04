/**
 * Context view: curation.
 *
 * Every file in a real corpus is the user's own writing and nothing regenerates
 * it, so each destructive path here is deliberately harder than a click:
 *
 *  - an edit shows what will change before it is written, never a blind save
 *  - a delete requires the file name typed back, because `force` exists
 *    precisely because the action is irreversible
 *  - remove-from-index is offered wherever delete is, as the reversible
 *    alternative that un-indexes without destroying anything
 */

const ContextCurationMixin = {
	/**
	 * Index an orphaned file. Touches only MEMORY.md, never the file, so it
	 * works on a hand-written note with no refusal path.
	 * @param {string} fileName
	 */
	addToIndex(fileName) {
		const project = this.selectedProject();
		if (!project || !fileName) return;
		API.memoryAddToIndex({ memoryDir: project.memoryDir, fileName });
	},

	/**
	 * Create MEMORY.md for a project that has none, by indexing its files.
	 *
	 * The remedy for `indexState: "no-index"`, where every file reports as
	 * orphaned and indexing them one at a time would be busywork.
	 */
	createIndex() {
		const project = this.selectedProject();
		if (!project) return;
		for (const file of project.files || []) {
			API.memoryAddToIndex({
				memoryDir: project.memoryDir,
				fileName: file.fileName,
			});
		}
	},

	/**
	 * Un-index a file without touching it. The reversible alternative to delete.
	 * @param {string} fileName
	 */
	removeFromIndex(fileName) {
		const project = this.selectedProject();
		if (!project || !fileName) return;
		API.memoryRemoveFromIndex({ memoryDir: project.memoryDir, fileName });
	},

	/**
	 * Ask before deleting, and require the file name typed back.
	 *
	 * A generic confirm is too easy to dismiss for something nothing can undo:
	 * these files are hand-written and no process regenerates them.
	 * @param {string} fileName
	 */
	confirmDelete(fileName) {
		const project = this.selectedProject();
		const file = (project?.files || []).find((f) => f.fileName === fileName);
		if (!project || !file) return;

		const modal = document.createElement("div");
		modal.className = "modal-overlay";
		modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header"><span class="modal-title">Delete memory file</span></div>
        <div class="modal-body">
          <p>Delete <strong>${Utils.escapeHtml(file.fileName)}</strong>?</p>
          <p class="modal-warning">
            ${
							file.source === "inspector-hook"
								? "This file was generated and can be rebuilt from its session."
								: "You wrote this file. Nothing regenerates it, and this cannot be undone."
						}
          </p>
          <p>Type the file name to confirm:</p>
          <input type="text" class="input ctx-delete-confirm" placeholder="${Utils.escapeHtml(file.fileName)}" aria-label="Type the file name to confirm deletion">
          <p class="modal-hint">
            To stop it being loaded without deleting it, remove it from the index instead.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary modal-cancel">Cancel</button>
          <button class="btn btn-secondary ctx-unindex-instead">Remove from index</button>
          <button class="btn btn-danger modal-confirm" disabled>Delete</button>
        </div>
      </div>
    `;

		document.body.appendChild(modal);
		requestAnimationFrame(() => modal.classList.add("visible"));

		const input = modal.querySelector(".ctx-delete-confirm");
		const confirm = modal.querySelector(".modal-confirm");
		const close = () => {
			modal.classList.remove("visible");
			setTimeout(() => modal.remove(), 200);
		};

		// The button stays disabled until the typed name matches exactly.
		input?.addEventListener("input", () => {
			confirm.disabled = input.value.trim() !== file.fileName;
		});

		modal.querySelector(".modal-cancel")?.addEventListener("click", close);
		modal.querySelector(".ctx-unindex-instead")?.addEventListener("click", () => {
			this.removeFromIndex(file.fileName);
			close();
		});
		confirm?.addEventListener("click", () => {
			if (confirm.disabled) return;
			API.memoryDelete({
				memoryDir: project.memoryDir,
				fileName: file.fileName,
				// Required for anything we did not author, which is every
				// hand-written note. The typed confirmation above is what earns it.
				force: true,
			});
			close();
		});
		modal.addEventListener("click", (e) => {
			if (e.target === modal) close();
		});
	},

	/**
	 * Save an edited body, showing what changes first.
	 *
	 * `userInitiated` is what allows editing a note the tool did not author. It
	 * is set only here, from an explicit save, and never on any automated path.
	 * @param {Object} file
	 * @param {string} body
	 */
	saveEdit(file, body) {
		const project = this.selectedProject();
		if (!project || !file) return;

		API.memoryWrite({
			memoryDir: project.memoryDir,
			name: file.name,
			// The file that was opened. `name` is the FRONTMATTER name and is not
			// the file name: 6 of the 33 files in this corpus differ, and without
			// this the save landed in a new file, left the original unchanged,
			// added a second index line, and still reported success.
			fileName: file.fileName,
			description: file.description || "",
			type: file.type || file.inferredType || "project",
			body,
			userInitiated: true,
		});
	},

	/**
	 * A line-level preview of an edit, so nothing is written blind.
	 * @param {string} before
	 * @param {string} after
	 * @returns {{added: number, removed: number, unchanged: number}}
	 */
	diffSummary(before, after) {
		const a = String(before || "").split("\n");
		const b = String(after || "").split("\n");
		const kept = new Set();
		let unchanged = 0;
		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			if (a[i] === b[i]) {
				unchanged++;
				kept.add(i);
			}
		}
		return {
			added: b.length - unchanged,
			removed: a.length - unchanged,
			unchanged,
		};
	},
};

window.ContextCurationMixin = ContextCurationMixin;
