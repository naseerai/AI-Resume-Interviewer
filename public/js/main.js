/**
 * main.js — Application bootstrap and event wiring
 * Connects all modules and handles global events
 */

// ─── Application State ────────────────────────────────────────────────────────
const App = (() => {
  let candidateName = 'Y';
  let isLightMode   = false;
  let sidebarOpen   = true;

  // ─── Initialize ──────────────────────────────────────────────────────────
  async function init() {
    // Apply saved theme
    const savedTheme = localStorage.getItem('ai_interviewer_theme');
    if (savedTheme === 'light') applyLightMode(true);

    // Initialize sub-modules
    Upload.init();

    // Check existing session
    await checkSession();

    // Wire all event listeners
    wireEvents();
    wireKeyboardShortcuts();

    // Hide loading overlay
    Utils.hideLoading();

    // Mobile overlay
    createMobileOverlay();
  }

  // ─── Check Existing Session ───────────────────────────────────────────────
  async function checkSession() {
    try {
      const data = await Utils.apiRequest('/api/session');
      if (data.hasResume && data.hasJD) {
        // Files already uploaded in this session
        await Upload.fetchAndDisplayProfile();
        Upload.updateStartButton();
      }
    } catch (err) {
      console.warn('[Session Check]:', err.message);
    }
  }

  // ─── Wire All Event Listeners ─────────────────────────────────────────────
  function wireEvents() {
    // ── Sidebar Buttons ──
    document.getElementById('start-interview-btn')?.addEventListener('click', () => {
      Interview.start();
    });

    document.getElementById('restart-btn')?.addEventListener('click', () => {
      Interview.restart();
    });

    document.getElementById('report-btn')?.addEventListener('click', () => {
      Report.view();
    });

    document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
      if (confirm('Clear chat history?')) {
        Chat.clearMessages();
        Utils.showToast('Chat cleared.', 'info');
      }
    });

    // ── Sidebar Toggle ──
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);

    // ── Mobile Menu ──
    document.getElementById('mobile-menu-btn')?.addEventListener('click', openMobileSidebar);

    // ── Theme Toggle ──
    document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);

    // ── Keyboard Shortcuts Button ──
    document.getElementById('keyboard-shortcuts-btn')?.addEventListener('click', () => {
      document.getElementById('shortcuts-modal').style.display = 'flex';
    });
    document.getElementById('shortcuts-modal-close')?.addEventListener('click', () => {
      document.getElementById('shortcuts-modal').style.display = 'none';
    });

    // ── Send Answer ──
    document.getElementById('send-btn')?.addEventListener('click', () => {
      Interview.submitAnswer();
    });

    // ── Auto-resize textarea + char count ──
    const textarea = document.getElementById('answer-input');
    textarea?.addEventListener('input', () => {
      Utils.autoResize(textarea);
      Interview.updateCharCount();
    });

    // ── Hint Button ──
    document.getElementById('hint-btn')?.addEventListener('click', () => {
      Interview.getHint();
    });
    document.getElementById('hint-modal-close')?.addEventListener('click', () => {
      document.getElementById('hint-modal').style.display = 'none';
    });

    // ── Voice Input ──
    document.getElementById('voice-input-btn')?.addEventListener('click', () => {
      if (Voice.isListeningNow()) {
        Voice.stopListening();
        document.getElementById('voice-input-btn').classList.remove('active');
      } else {
        document.getElementById('voice-input-btn').classList.add('active');
        Voice.startListening(
          (transcript) => {
            document.getElementById('voice-input-btn').classList.remove('active');
          },
          (err) => {
            document.getElementById('voice-input-btn').classList.remove('active');
          }
        );
      }
    });

    // ── Voice Mode Toggle (AI reads questions) ──
    document.getElementById('voice-toggle-btn')?.addEventListener('click', () => {
      Voice.toggleVoiceMode();
    });

    // ── Skip Question ──
    document.getElementById('skip-btn')?.addEventListener('click', async () => {
      if (!Interview.getIsActive()) return;
      const confirmed = confirm('Skip this question?');
      if (!confirmed) return;

      const textarea = document.getElementById('answer-input');
      const original = textarea.value;
      textarea.value = 'I would like to skip this question.';
      await Interview.submitAnswer();
      if (!original) textarea.value = '';
    });

    // ── End Interview ──
    document.getElementById('end-interview-btn')?.addEventListener('click', () => {
      Interview.endInterview();
    });

    // ── Modal close on backdrop click ──
    ['hint-modal', 'shortcuts-modal'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        if (e.target.id === id) {
          e.target.style.display = 'none';
        }
      });
    });

    // ── Escape key closes modals ──
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ['hint-modal', 'shortcuts-modal'].forEach(id => {
          document.getElementById(id).style.display = 'none';
        });
        if (Voice.isListeningNow()) Voice.stopListening();
      }
    });
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────
  function wireKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

      // Ctrl+Enter — Send Answer (works even in textarea)
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (Interview.getIsActive()) Interview.submitAnswer();
        return;
      }

      // Rest only when not typing
      if (!isInputFocused || e.ctrlKey) {
        if (e.ctrlKey) {
          switch (e.key.toLowerCase()) {
            case 'h': // Hint
              e.preventDefault();
              if (Interview.getIsActive()) Interview.getHint();
              break;
            case 'm': // Mic
              e.preventDefault();
              document.getElementById('voice-input-btn')?.click();
              break;
            case 'k': // Skip
              e.preventDefault();
              document.getElementById('skip-btn')?.click();
              break;
            case 'b': // Sidebar
              e.preventDefault();
              toggleSidebar();
              break;
            case 'i': // Start interview
              e.preventDefault();
              if (!Interview.getIsActive()) {
                const btn = document.getElementById('start-interview-btn');
                if (!btn?.disabled) Interview.start();
              }
              break;
            case 't': // Theme
              e.preventDefault();
              toggleTheme();
              break;
          }
        }
      }
    });
  }

  // ─── Sidebar Toggle ───────────────────────────────────────────────────────
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebarOpen = !sidebarOpen;
    sidebar.classList.toggle('collapsed', !sidebarOpen);
  }

  function openMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.add('mobile-open');
    if (overlay) overlay.classList.add('visible');
  }

  function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('visible');
  }

  function createMobileOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', closeMobileSidebar);
  }

  // ─── Theme Toggle ─────────────────────────────────────────────────────────
  function applyLightMode(light) {
    isLightMode = light;
    document.body.classList.toggle('light-mode', light);

    const btn  = document.getElementById('theme-toggle-btn');
    const icon = document.getElementById('theme-icon');

    if (light) {
      if (btn)  btn.innerHTML  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" id="theme-icon"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke-linecap="round"/></svg> Light Mode`;
    } else {
      if (btn)  btn.innerHTML  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" id="theme-icon"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke-linecap="round" stroke-linejoin="round"/></svg> Dark Mode`;
    }
  }

  function toggleTheme() {
    const newMode = !isLightMode;
    applyLightMode(newMode);
    localStorage.setItem('ai_interviewer_theme', newMode ? 'light' : 'dark');
    Utils.showToast(`Switched to ${newMode ? 'light' : 'dark'} mode`, 'info', 2000);
  }

  // ─── Expose Candidate Name ────────────────────────────────────────────────
  function setCandidateName(name) { candidateName = name || 'Y'; }
  function getCandidateName()     { return candidateName; }

  return {
    init,
    toggleSidebar,
    toggleTheme,
    setCandidateName,
    getCandidateName,
  };
})();

window.App = App;

// ─── Bootstrap on DOM Ready ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Configure marked.js
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false,
    });
  }

  // Initialize the app
  App.init().catch(err => {
    console.error('[App Init Error]:', err);
    Utils.hideLoading();
    Utils.showToast('Failed to initialize. Please refresh.', 'error');
  });
});
