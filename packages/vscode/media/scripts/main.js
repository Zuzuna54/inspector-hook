/**
 * Inspector Hook Webview - Main Entry Point
 * Initializes the application and sets up event handlers
 */

// ==========================================================================
// Utility Functions
// ==========================================================================

const Utils = {
  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Format timestamp to time string
   * @param {string|number|Date} timestamp - Timestamp to format
   * @returns {string} Formatted time string (HH:MM:SS)
   */
  formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  },

  /**
   * Format timestamp to date string
   * @param {string|number|Date} timestamp - Timestamp to format
   * @returns {string} Formatted date string
   */
  formatDate(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * Format duration between two timestamps
   * @param {string|number|Date} startTime - Start timestamp
   * @param {string|number|Date} endTime - End timestamp (optional, defaults to now)
   * @returns {string} Formatted duration string
   */
  formatDuration(startTime, endTime) {
    if (!startTime) return '';
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const ms = end - start;

    if (ms < 0) return '';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  },

  /**
   * Format file size in bytes to human readable string
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size string
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  /**
   * Get file name from path
   * @param {string} filePath - Full file path
   * @returns {string} File name
   */
  getFileName(filePath) {
    if (!filePath) return '';
    return filePath.split('/').pop() || filePath;
  },

  /**
   * Get directory from path
   * @param {string} filePath - Full file path
   * @returns {string} Directory path
   */
  getDirectory(filePath) {
    if (!filePath) return '';
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/') || '/';
  },

  /**
   * Debounce a function
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Throttle a function
   * @param {Function} fn - Function to throttle
   * @param {number} limit - Minimum time between calls in milliseconds
   * @returns {Function} Throttled function
   */
  throttle(fn, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  /**
   * Generate a unique ID
   * @returns {string} Unique ID
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  },

  /**
   * Deep clone an object
   * @param {Object} obj - Object to clone
   * @returns {Object} Cloned object
   */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  // ==========================================================================
  // Syntax Highlighting
  // ==========================================================================

  /**
   * Detect language from file extension or content
   * @param {string} filePath - File path (optional)
   * @param {string} content - Code content (optional)
   * @returns {string} Language identifier
   */
  detectLanguage(filePath, content) {
    if (filePath) {
      const ext = filePath.split('.').pop()?.toLowerCase();
      const extMap = {
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'json': 'json',
        'css': 'css',
        'scss': 'css',
        'less': 'css',
        'html': 'html',
        'htm': 'html',
        'xml': 'html',
        'svg': 'html',
        'md': 'markdown',
        'markdown': 'markdown',
        'py': 'python',
        'rb': 'ruby',
        'go': 'go',
        'rs': 'rust',
        'sh': 'bash',
        'bash': 'bash',
        'zsh': 'bash',
        'yml': 'yaml',
        'yaml': 'yaml'
      };
      if (ext && extMap[ext]) return extMap[ext];
    }

    // Try to detect from content
    if (content) {
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return 'html';
      if (trimmed.startsWith('#') || trimmed.includes('```')) return 'markdown';
    }

    return 'plaintext';
  },

  /**
   * Tokenize and highlight code
   * @param {string} code - Code to highlight
   * @param {string} language - Language identifier
   * @returns {string} HTML with syntax highlighting spans
   */
  highlightCode(code, language = 'plaintext') {
    if (!code) return '';

    // Escape HTML first
    let escaped = this.escapeHtml(code);

    // Language-specific tokenization
    switch (language) {
      case 'json':
        return this._highlightJson(escaped);
      case 'javascript':
      case 'typescript':
        return this._highlightJavaScript(escaped);
      case 'css':
        return this._highlightCss(escaped);
      case 'html':
        return this._highlightHtml(escaped);
      case 'markdown':
        return this._highlightMarkdown(escaped);
      default:
        return escaped;
    }
  },

  /**
   * Highlight JSON code
   * @private
   */
  _highlightJson(code) {
    return code
      // Strings (property values)
      .replace(/:(\s*)(&quot;[^&]*?&quot;)/g, ':<span class="token string">$2</span>')
      // Property names (keys)
      .replace(/(&quot;[^&]+?&quot;)(\s*:)/g, '<span class="token property">$1</span>$2')
      // Numbers
      .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="token number">$1</span>')
      // Boolean and null
      .replace(/:\s*(true|false|null)\b/g, ': <span class="token boolean">$1</span>')
      // Punctuation
      .replace(/([{}\[\],])/g, '<span class="token punctuation">$1</span>');
  },

  /**
   * Highlight JavaScript/TypeScript code
   * @private
   */
  _highlightJavaScript(code) {
    const keywords = 'async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield';
    const types = 'string|number|boolean|object|any|void|never|unknown|null|undefined|Array|Promise|Map|Set|Date|RegExp|Error';

    return code
      // Comments (single line)
      .replace(/(\/\/[^\n]*)/g, '<span class="token comment">$1</span>')
      // Strings (single and double quotes)
      .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*`)/g, '<span class="token string">$1</span>')
      // Template literals
      .replace(/(\${[^}]+})/g, '<span class="token variable">$1</span>')
      // Keywords
      .replace(new RegExp(`\\b(${keywords})\\b`, 'g'), '<span class="token keyword">$1</span>')
      // Types
      .replace(new RegExp(`\\b(${types})\\b`, 'g'), '<span class="token type">$1</span>')
      // Numbers
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="token number">$1</span>')
      // Boolean
      .replace(/\b(true|false)\b/g, '<span class="token boolean">$1</span>')
      // Function calls
      .replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="token function">$1</span>(')
      // Operators
      .replace(/([=!<>+\-*/%&|^~]+)/g, '<span class="token operator">$1</span>');
  },

  /**
   * Highlight CSS code
   * @private
   */
  _highlightCss(code) {
    return code
      // Comments
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token comment">$1</span>')
      // Selectors (class, id, element)
      .replace(/([.#]?[\w-]+)\s*\{/g, '<span class="token selector">$1</span> {')
      // Properties
      .replace(/([\w-]+)(\s*:)/g, '<span class="token property">$1</span>$2')
      // Values with units
      .replace(/:\s*([\d.]+)(px|em|rem|%|vh|vw|s|ms)/g, ': <span class="token number">$1</span><span class="token unit">$2</span>')
      // Colors
      .replace(/(#[0-9a-fA-F]{3,8})/g, '<span class="token string">$1</span>')
      // Strings
      .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="token string">$1</span>');
  },

  /**
   * Highlight HTML code
   * @private
   */
  _highlightHtml(code) {
    return code
      // Comments
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="token comment">$1</span>')
      // Tag names
      .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="token tag-name">$2</span>')
      // Attributes
      .replace(/([\w-]+)(=)/g, '<span class="token attr-name">$1</span>$2')
      // Attribute values
      .replace(/(=)(&quot;[^&]*?&quot;)/g, '$1<span class="token attr-value">$2</span>')
      // Punctuation
      .replace(/(&lt;\/?|\/?\s*&gt;)/g, '<span class="token punctuation">$1</span>');
  },

  /**
   * Highlight Markdown code
   * @private
   */
  _highlightMarkdown(code) {
    return code
      // Headers
      .replace(/^(#{1,6}\s+.*)$/gm, '<span class="token title">$1</span>')
      // Bold
      .replace(/(\*\*[^*]+\*\*|__[^_]+__)/g, '<span class="token bold">$1</span>')
      // Italic
      .replace(/(\*[^*]+\*|_[^_]+_)/g, '<span class="token italic">$1</span>')
      // Code blocks
      .replace(/(```[\s\S]*?```)/g, '<span class="token code">$1</span>')
      // Inline code
      .replace(/(`[^`]+`)/g, '<span class="token code">$1</span>')
      // Links
      .replace(/(\[[^\]]+\]\([^)]+\))/g, '<span class="token url">$1</span>');
  },

  /**
   * Create a highlighted code block with optional header
   * @param {string} code - Code to highlight
   * @param {string} language - Language identifier
   * @param {Object} options - Options (showHeader, maxHeight)
   * @returns {string} HTML code block
   */
  createCodeBlock(code, language = 'plaintext', options = {}) {
    const { showHeader = true, maxHeight = 300 } = options;
    const highlighted = this.highlightCode(code, language);
    const langDisplay = language === 'javascript' ? 'JS' :
                        language === 'typescript' ? 'TS' :
                        language.toUpperCase();

    if (showHeader) {
      return `
        <div class="code-block">
          <div class="code-block-header">
            <span class="code-block-language">${langDisplay}</span>
          </div>
          <div class="code-scrollable" style="max-height: ${maxHeight}px;">
            <pre class="language-${language}"><code>${highlighted}</code></pre>
          </div>
        </div>
      `;
    }

    return `<pre class="language-${language}" style="max-height: ${maxHeight}px;"><code>${highlighted}</code></pre>`;
  }
};

// Make Utils globally available
window.Utils = Utils;

// ==========================================================================
// Application Initialization
// ==========================================================================

/**
 * Initialize the application
 */
function init() {
  console.log('========================================');
  console.log('[Inspector Hook] WEBVIEW INITIALIZING');
  console.log('========================================');
  console.log('[Inspector Hook] API available:', typeof API !== 'undefined');
  console.log('[Inspector Hook] API.vscode available:', API?.vscode != null);
  console.log('[Inspector Hook] State available:', typeof State !== 'undefined');
  console.log('[Inspector Hook] Router available:', typeof Router !== 'undefined');

  // Set up tab navigation
  setupTabNavigation();

  // Set up search
  setupSearch();

  // Set up clear button
  setupClearButton();

  // Set up header stats updates
  setupHeaderStats();

  // Navigate to default view
  Router.navigate('dashboard');

  console.log('[Inspector Hook] Webview initialized, sending webview-ready...');
}

/**
 * Set up tab navigation
 */
function setupTabNavigation() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const viewName = tab.dataset.view;
      if (viewName) {
        Router.navigate(viewName);
      }
    });

    // Keyboard support
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const viewName = tab.dataset.view;
        if (viewName) {
          Router.navigate(viewName);
        }
      }
    });
  });
}

/**
 * Set up search input
 */
function setupSearch() {
  const searchInput = document.getElementById('search');
  if (searchInput) {
    searchInput.addEventListener('input', Utils.debounce((e) => {
      const query = e.target.value.trim();
      State.update('searchQuery', query);

      // Also request filtered logs from backend
      if (query) {
        API.getLogs({ search: query });
      } else {
        API.getLogs();
      }
    }, 300));

    // Clear search on Escape
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        State.update('searchQuery', '');
        API.getLogs();
      }
    });
  }
}

/**
 * Set up clear button
 */
function setupClearButton() {
  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear all logs? This cannot be undone.')) {
        API.clearLogs();
      }
    });
  }
}

/**
 * Set up header stats updates
 */
function setupHeaderStats() {
  // Subscribe to stats updates
  State.subscribe('stats', updateHeaderStats);
  State.subscribe('fileChanges', updateHeaderStats);

  // Initial render
  updateHeaderStats();
}

/**
 * Update header stats display
 */
function updateHeaderStats() {
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

// ==========================================================================
// Start Application
// ==========================================================================

// Wait for DOM to be ready
console.log('[Inspector Hook] Script loaded, readyState:', document.readyState);

if (document.readyState === 'loading') {
  console.log('[Inspector Hook] Waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Inspector Hook] DOMContentLoaded fired');
    init();
    // Signal to VS Code that webview is ready to receive messages
    console.log('[Inspector Hook] Sending webview-ready to extension...');
    API.send('webview-ready', {});
    console.log('[Inspector Hook] webview-ready sent!');
  });
} else {
  console.log('[Inspector Hook] DOM already ready, initializing immediately');
  init();
  // Signal to VS Code that webview is ready to receive messages
  console.log('[Inspector Hook] Sending webview-ready to extension...');
  API.send('webview-ready', {});
  console.log('[Inspector Hook] webview-ready sent!');
}
