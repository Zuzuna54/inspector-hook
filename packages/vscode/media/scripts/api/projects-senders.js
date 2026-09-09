/**
 * The global project list.
 *
 * Asked for once at startup and on demand — it is derived from every store the
 * core holds, so it changes only when sessions, memory, changes or research do.
 */

const ProjectsApiMixin = {
	getProjects() {
		this.send("projects-list", {});
	},
};

window.ProjectsApiMixin = ProjectsApiMixin;
