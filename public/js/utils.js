/**
 * utils.js — Shared utility functions
 */

// ─── Session Management ──────────────────────────────────────────────────────
const SESSION_KEY = 'ai_interviewer_session_id';

function getSessionId() {
  return localStorage.getItem(SESSION_KEY);
}
function setSessionId(id) {
  localStorage.setItem(SESSION_KEY, id);
}
function clearSessionId() {
  localStorage.removeItem(SESSION_KEY);
}

// ─── API Request Helper ──────────────────────────────────────────────────────
async function apiRequest(url, options = {}) {
  const sessionId = getSessionId();
  const headers = {
    'Content-Type': 'application/json',
    ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
    ...(options.headers || {}),
  };

  // For FormData, let the browser set Content-Type
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const res = await fetch(url, { ...options, headers });

  // Capture new session ID if returned
  const newSessionId = res.headers.get('X-Session-Id');
  if (newSessionId) setSessionId(newSessionId);

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Server error ${res.status}`);
  }

  return data;
}

// ─── Toast Notifications ─────────────────────────────────────────────────────
const toastContainer = () => document.getElementById('toast-container');

function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
  `;
  toastContainer().appendChild(toast);

  // Auto-remove
  const remove = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  };
  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ─── Loading Overlay ─────────────────────────────────────────────────────────
function showLoading(text = 'Please wait...') {
  const overlay = document.getElementById('loading-overlay');
  const textEl = document.getElementById('loading-text');
  if (textEl) textEl.textContent = text;
  overlay.classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ─── DOM Helpers ─────────────────────────────────────────────────────────────
function $(selector, parent = document) { return parent.querySelector(selector); }
function $$(selector, parent = document) { return [...parent.querySelectorAll(selector)]; }

function show(el) { if (el) el.style.display = ''; }
function hide(el) { if (el) el.style.display = 'none'; }
function toggle(el, condition) {
  if (el) el.style.display = condition ? '' : 'none';
}

function setVisible(el, visible) {
  if (!el) return;
  if (visible) el.style.display = '';
  else el.style.display = 'none';
}

// ─── Formatting ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatTimestamp(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ─── Markdown Rendering ───────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text);
  try {
    return marked.parse(text, {
      breaks: true,
      gfm: true,
      sanitize: false,
    });
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ─── Auto-resize Textarea ────────────────────────────────────────────────────
function autoResize(textarea) {
  textarea.style.height = 'auto';
  const newHeight = Math.min(textarea.scrollHeight, 160);
  textarea.style.height = newHeight + 'px';
}

// ─── Smooth Scroll ───────────────────────────────────────────────────────────
function scrollToBottom(el, smooth = true) {
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

// ─── Score to Color ──────────────────────────────────────────────────────────
function scoreToColor(score) {
  if (score >= 80) return '#22c55e';
  if (score >= 65) return '#3b82f6';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

// ─── Circumference for Ring SVG ───────────────────────────────────────────────
function scoreToCircumference(score, radius = 30) {
  const circumference = 2 * Math.PI * radius;
  return `${(score / 100) * circumference} ${circumference}`;
}

// ─── Local Storage Helpers ───────────────────────────────────────────────────
const CHAT_HISTORY_KEY = 'ai_interviewer_chat_history';

function saveChatHistory(messages) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages));
  } catch {}
}
function loadChatHistory() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY)) || [];
  } catch { return []; }
}
function clearChatHistory() {
  localStorage.removeItem(CHAT_HISTORY_KEY);
}

// ─── Debounce ────────────────────────────────────────────────────────────────
function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ─── Expose to global ────────────────────────────────────────────────────────
window.Utils = {
  getSessionId, setSessionId, clearSessionId,
  apiRequest,
  showToast, showLoading, hideLoading,
  $, $$, show, hide, toggle, setVisible,
  formatTime, formatTimestamp, formatFileSize, capitalize,
  renderMarkdown, escapeHtml,
  autoResize, scrollToBottom,
  scoreToColor, scoreToCircumference,
  saveChatHistory, loadChatHistory, clearChatHistory,
  debounce,
};
