/**
 * View Router
 * Handles tab navigation and view lifecycle
 */

const Router = {
  // Registered views
  views: {},

  // Current active view
  currentView: null,

  // Navigation history
  history: [],
  maxHistory: 20,

  /**
   * Register a view
   * @param {string} name - View name
   * @param {Object} view - View object with init, render, cleanup methods
   */
  register(name, view) {
    this.views[name] = view;
  },

  /**
   * Navigate to a view
   * @param {string} viewName - Name of the view to navigate to
   * @param {Object} params - Optional parameters to pass to the view
   */
  navigate(viewName, params = {}) {
    // Validate view exists
    if (!this.views[viewName]) {
      console.warn(`[Router] View "${viewName}" not registered`);
      return;
    }

    // Cleanup previous view
    if (this.currentView && this.views[this.currentView]?.cleanup) {
      try {
        this.views[this.currentView].cleanup();
      } catch (error) {
        console.error(`[Router] Error cleaning up view "${this.currentView}":`, error);
      }
    }

    // Add to history
    if (this.currentView && this.currentView !== viewName) {
      this.history.push(this.currentView);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
    }

    // Update current view
    this.currentView = viewName;
    State.update('currentView', viewName);

    // Update tab UI
    document.querySelectorAll('.tab').forEach(tab => {
      const isActive = tab.dataset.view === viewName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Show/hide views
    document.querySelectorAll('.view').forEach(view => {
      const isActive = view.id === `view-${viewName}`;
      view.classList.toggle('hidden', !isActive);
      view.classList.toggle('active', isActive);
      view.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    // Initialize view
    const view = this.views[viewName];
    if (view?.init) {
      try {
        view.init(params);
      } catch (error) {
        console.error(`[Router] Error initializing view "${viewName}":`, error);
      }
    }

    // Emit navigation event
    this.emit('navigate', { view: viewName, params });
  },

  /**
   * Go back to previous view
   */
  back() {
    if (this.history.length > 0) {
      const previousView = this.history.pop();
      this.navigate(previousView);
    }
  },

  /**
   * Get current view name
   * @returns {string} Current view name
   */
  getCurrentView() {
    return this.currentView;
  },

  /**
   * Check if a view is registered
   * @param {string} name - View name
   * @returns {boolean}
   */
  hasView(name) {
    return name in this.views;
  },

  /**
   * Get all registered view names
   * @returns {string[]}
   */
  getViewNames() {
    return Object.keys(this.views);
  },

  // ==========================================================================
  // Event Emitter
  // ==========================================================================
  _eventListeners: {},

  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this._eventListeners[event]) {
      this._eventListeners[event] = [];
    }
    this._eventListeners[event].push(callback);
  },

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  off(event, callback) {
    if (this._eventListeners[event]) {
      this._eventListeners[event] = this._eventListeners[event].filter(
        cb => cb !== callback
      );
    }
  },

  /**
   * Emit event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    if (this._eventListeners[event]) {
      this._eventListeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[Router] Error in event listener for "${event}":`, error);
        }
      });
    }
  }
};

// Make globally available
window.Router = Router;
