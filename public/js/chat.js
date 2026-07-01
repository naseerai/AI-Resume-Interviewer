/**
 * chat.js — Chat UI rendering, messages, feedback cards
 */

const Chat = (() => {
  const { renderMarkdown, formatTimestamp, scrollToBottom, escapeHtml } = Utils;

  const messagesEl  = () => document.getElementById('chat-messages');
  const typingEl    = () => document.getElementById('typing-indicator');

  // Stored messages for chat history
  const messages = [];

  // ─── Show / Hide Typing Indicator ─────────────────────────────────────────
  function showTyping(text = 'Thinking...') {
    const el = typingEl();
    if (!el) return;
    const t = el.querySelector('.typing-text');
    if (t) t.textContent = text;
    el.style.display = 'flex';
    scrollToBottom(messagesEl());
  }
  function hideTyping() {
    const el = typingEl();
    if (el) el.style.display = 'none';
  }

  // ─── Add AI Message ───────────────────────────────────────────────────────
  function addAIMessage(content, options = {}) {
    const {
      questionNumber = null,
      difficulty     = null,
      timestamp      = new Date().toISOString(),
      isOpening      = false,
    } = options;

    const msg = { role: 'ai', content, timestamp, questionNumber, difficulty };
    messages.push(msg);
    Utils.saveChatHistory(messages);

    const container = messagesEl();
    if (!container) return;

    const badge = questionNumber
      ? `<div class="question-badge" aria-label="Question ${questionNumber}" role="note">
           <span aria-hidden="true">❓</span> Question ${questionNumber}
           ${difficulty ? `<span class="difficulty-badge ${difficulty.toLowerCase()}" style="margin-left:6px;">${Utils.capitalize(difficulty)}</span>` : ''}
         </div>`
      : '';

    const div = document.createElement('div');
    div.className = 'message ai';
    div.setAttribute('role', 'listitem');
    div.innerHTML = `
      <div class="message-avatar" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="15" fill="url(#ihgrad2)" opacity="0.2"/>
          <circle cx="16" cy="12" r="5" fill="url(#ihgrad2)"/>
          <path d="M6 26c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="url(#ihgrad2)" stroke-width="2" stroke-linecap="round"/>
          <defs>
            <linearGradient id="ihgrad2" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop stop-color="#6c63ff"/><stop offset="1" stop-color="#3ecfcf"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div class="message-body">
        <div class="message-meta">
          <span class="message-name">Interviewer</span>
          <span class="message-time">${formatTimestamp(timestamp)}</span>
        </div>
        ${badge}
        <div class="message-bubble" id="msg-${messages.length}">
          ${renderMarkdown(content)}
        </div>
      </div>
    `;

    container.appendChild(div);
    scrollToBottom(container);

    // Speak if voice enabled
    if (Voice.isVoiceEnabled()) {
      Voice.speak(content);
    }

    return div;
  }

  // ─── Add User Message ─────────────────────────────────────────────────────
  function addUserMessage(content, timestamp = new Date().toISOString()) {
    const msg = { role: 'user', content, timestamp };
    messages.push(msg);
    Utils.saveChatHistory(messages);

    const container = messagesEl();
    if (!container) return;

    const initial = (window.App?.getCandidateName?.() || 'Y').charAt(0).toUpperCase();

    const div = document.createElement('div');
    div.className = 'message user';
    div.setAttribute('role', 'listitem');
    div.innerHTML = `
      <div class="message-avatar" aria-label="You" style="background:var(--grad-primary);">${initial}</div>
      <div class="message-body">
        <div class="message-meta">
          <span class="message-name">You</span>
          <span class="message-time">${formatTimestamp(timestamp)}</span>
        </div>
        <div class="message-bubble">
          ${escapeHtml(content)}
        </div>
      </div>
    `;

    container.appendChild(div);
    scrollToBottom(container);

    return div;
  }

  // ─── Add Feedback Card ────────────────────────────────────────────────────
  function addFeedbackCard(evaluation, parentEl) {
    if (!evaluation || !parentEl) return;

    const { scores = {}, rating = 'Good', positiveFeedback = [], improvements = [],
            betterWording = '', missingPoints = [], shortComment = '' } = evaluation;

    const scoreItems = [
      ['Communication', scores.communication],
      ['Technical',     scores.technicalAccuracy],
      ['Confidence',    scores.confidence],
      ['Grammar',       scores.grammar],
      ['Professionalism', scores.professionalism],
      ['Relevance',     scores.relevance],
    ].filter(([,v]) => v != null);

    const ratingClass = rating.replace(/\s+/g, '_');

    const card = document.createElement('div');
    card.className = 'feedback-card';
    card.innerHTML = `
      <div class="feedback-header" role="button" tabindex="0" aria-expanded="false"
           aria-label="Toggle feedback" onclick="this.setAttribute('aria-expanded', this.nextElementSibling.classList.contains('open') ? 'false' : 'true'); this.nextElementSibling.classList.toggle('open');">
        <span class="feedback-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Live Feedback · Overall ${scores.overall || '—'}%
        </span>
        <span class="feedback-rating ${ratingClass}" role="status">${rating}</span>
      </div>
      <div class="feedback-body">
        ${scoreItems.length ? `
          <div class="score-grid">
            ${scoreItems.map(([label, val]) => `
              <div class="mini-score">
                <span class="mini-score-label">${label}</span>
                <div class="mini-score-bar-wrap" role="progressbar" aria-valuenow="${val}" aria-valuemin="0" aria-valuemax="100" aria-label="${label} score: ${val}%">
                  <div class="mini-score-bar" style="width:${val}%; background:${Utils.scoreToColor(val)};"></div>
                </div>
                <span class="mini-score-val">${val}%</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${shortComment ? `<p class="feedback-comment" style="margin-bottom:12px;">"${escapeHtml(shortComment)}"</p>` : ''}

        ${positiveFeedback.length ? `
          <div class="feedback-section">
            <p class="feedback-section-title">✅ Positives</p>
            <ul class="feedback-list">${positiveFeedback.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${improvements.length ? `
          <div class="feedback-section">
            <p class="feedback-section-title">🔧 Improvements</p>
            <ul class="feedback-list">${improvements.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${betterWording ? `
          <div class="feedback-section">
            <p class="feedback-section-title">💬 Better Phrasing</p>
            <p class="feedback-comment">"${escapeHtml(betterWording)}"</p>
          </div>
        ` : ''}

        ${missingPoints.length ? `
          <div class="feedback-section">
            <p class="feedback-section-title">📌 Missing Points</p>
            <ul class="feedback-list">${missingPoints.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `;

    // Keyboard accessibility for feedback toggle
    const header = card.querySelector('.feedback-header');
    header?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });

    parentEl.appendChild(card);
    scrollToBottom(messagesEl());
  }

  // ─── Add System Notice ────────────────────────────────────────────────────
  function addSystemNotice(text, type = 'info') {
    const container = messagesEl();
    if (!container) return;

    const colors = {
      info:    'var(--info)',
      success: 'var(--success)',
      warning: 'var(--warning)',
      error:   'var(--danger)',
    };

    const div = document.createElement('div');
    div.style.cssText = `
      text-align:center; padding:8px 16px; margin:4px auto;
      font-size:0.78rem; color:${colors[type] || colors.info};
      background:${colors[type]}14; border:1px solid ${colors[type]}33;
      border-radius:var(--radius-full); max-width:400px;
      animation: fadeSlideIn 0.3s ease;
    `;
    div.setAttribute('role', 'status');
    div.textContent = text;
    container.appendChild(div);
    scrollToBottom(container);
  }

  // ─── Clear All Messages ───────────────────────────────────────────────────
  function clearMessages() {
    const container = messagesEl();
    if (container) container.innerHTML = '';
    messages.length = 0;
    Utils.clearChatHistory();
  }

  // ─── Get All Messages ─────────────────────────────────────────────────────
  function getMessages() { return [...messages]; }

  return {
    showTyping,
    hideTyping,
    addAIMessage,
    addUserMessage,
    addFeedbackCard,
    addSystemNotice,
    clearMessages,
    getMessages,
  };
})();

window.Chat = Chat;
