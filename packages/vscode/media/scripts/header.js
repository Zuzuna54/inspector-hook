/**
 * The header: global search, clear, the connection dot and the stat counters.
 *
 * Split out of main.js when it crossed the 600-line limit.
 *
 * Published as one object on `window` rather than left as bare function
 * declarations. Browsers share a global scope across classic scripts, so
 * declarations would work in the panel — but they do NOT cross an `eval`
 * boundary in strict mode, which is how the view-registry test loads these
 * files. A split that works in the browser and is invisible to the suite is
 * exactly the kind this project keeps finding, so it follows the convention
 * every other shared module here already uses.
 */

const Header = {
/**
 * Run the global search and show its results.
 *
 * Switching to Find is the point: a global search whose results appear
 * somewhere you have to go and find is a filter, not a search — which is what
 * this box was.
 */
	runGlobalSearch: function (query) {
  State.update('contextFind', {
    ...State.contextFind,
    query,
    searching: true,
  });
  if (typeof Router !== 'undefined' && Router.navigate) {
    Router.navigate('find');
  }
  API.contextFind({
    query,
    projectId:
      typeof ProjectFilter !== 'undefined' ? ProjectFilter.selected()?.id : undefined,
    limit: 20,
  });
	},

/**
 * The header search — global, across every corpus.
 *
 * It used to call `API.getLogs({search})` and nothing else, so a box sitting in
 * the header, above every view, filtered ONE view by a case-insensitive
 * substring of a log's summary line. It could not find a memory file, a
 * session digest, a file change or a prompt, and inside logs it could not
 * reach anything the summary did not already contain.
 *
 * It now runs the five-corpus search and shows the results in Find. Narrowing
 * the log table itself moved to a filter box inside the Logs view, next to the
 * level and hook filters it belongs with.
 */
	setupSearch: function () {
  const searchInput = document.getElementById('search');
  if (searchInput) {
    searchInput.addEventListener('input', Utils.debounce((e) => {
      const query = e.target.value.trim();
      if (!query) return;
      Header.runGlobalSearch(query);
    }, 300));

    // Enter goes to the results even if the debounce has not fired yet.
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) Header.runGlobalSearch(query);
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        State.update('contextFind', { ...State.contextFind, query: '', groups: [] });
      }
    });
  }
	},

/**
 * Set up clear button
 */
	setupClearButton: function () {
  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear all logs? This cannot be undone.')) {
        API.clearLogs();
      }
    });
  }
	},

/**
 * Set up header stats updates
 */
/**
 * Reflect the core's liveness in the header.
 *
 * The markup shipped with class "connected" and the literal text "Connected",
 * and nothing anywhere read either element -- so the panel asserted a healthy
 * core rather than reporting one, and kept saying "Connected" after the core
 * had exited. `.status-indicator.disconnected` was already styled, with no code
 * path that could ever add it.
 */
	setupConnectionIndicator: function () {
	const render = () => {
		const dot = document.getElementById("status-indicator");
		const text = document.getElementById("status-text");
		if (!dot || !text) return;
		const ok = State.connected;
		dot.classList.toggle("connected", ok);
		dot.classList.toggle("disconnected", !ok);
		text.textContent = ok ? "Connected" : "Core not running";
		text.title = ok ? "" : State.connectionReason || "";
	};
	State.subscribe("connected", render);
	State.subscribe("connectionReason", render);
	render();
	},

	setupHeaderStats: function () {
  // Subscribe to stats updates
  // Bound through the object, not as a bare identifier: these run long
  // after load, and a bare reference is undefined outside this file's scope.
  State.subscribe('stats', () => Header.updateHeaderStats());
  State.subscribe('fileChanges', () => Header.updateHeaderStats());

  // Initial render
  Header.updateHeaderStats();
	},

/**
 * Update header stats display
 */
	updateHeaderStats: function () {
  const stats = State.stats;
  const fileChanges = State.fileChanges;

  const errorsStat = document.getElementById('stat-errors');
  if (errorsStat) {
    errorsStat.textContent = `${stats.errors || 0} errors`;
  }

  const changesStat = document.getElementById('stat-changes');
  if (changesStat) {
    changesStat.textContent = `${fileChanges.length || 0} changes`;
  }
	}
};

window.Header = Header;
