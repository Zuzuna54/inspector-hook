/**
 * Skills and MCP tool senders (M8).
 *
 * `skillsOverview()` reads 121 transcripts in the core, which caches the
 * result. `refresh` is explicit so a tab switch is instant and a recount is a
 * deliberate click.
 */

const SkillsApiMixin = {
	/** Installed skills, what fired, and the MCP servers. */
	skillsOverview(refresh = false) {
		this.send("skills-overview", { refresh });
	},

	/** One skill's SKILL.md, for the detail pane. */
	skillsReadFile(id) {
		this.send("skills-read-file", { id });
	},

	/**
	 * Archive a skill, or restore one.
	 *
	 * Deliberately not named `skillsToggle`: settings.json has no skills key,
	 * so nothing is being enabled or disabled. This moves a directory.
	 */
	skillsSetArchived(id, archived) {
		this.send("skills-set-archived", { id, archived });
	},
};

if (typeof window !== "undefined" && window.API) {
	Object.assign(window.API, SkillsApiMixin);
}
