/**
 * interview.js — Interview flow controller
 * Manages start, Q&A, hints, timer, progress, difficulty
 */

const Interview = (() => {
  const { apiRequest, showToast, showLoading, hideLoading, formatTime } = Utils;

  // ─── State ────────────────────────────────────────────────────────────────
  let isActive       = false;
  let questionCount  = 0;
  let currentDiff    = 'easy';
  let timerInterval  = null;
  let elapsedSeconds = 0;
  let candidateName  = '';
  let isProcessing   = false;

  // ─── DOM Elements ─────────────────────────────────────────────────────────
  const getEl = (id) => document.getElementById(id);

  // ─── Start Interview ──────────────────────────────────────────────────────
  async function start() {
    if (isActive) return;

    showLoading('Analyzing your documents and preparing interview...');

    try {
      const data = await apiRequest('/api/interview/start', { method: 'POST' });

      isActive      = true;
      questionCount = 0;
      elapsedSeconds = 0;
      currentDiff   = 'easy';

      // Store candidate name globally
      candidateName = data.profile?.candidateName || 'Candidate';
      if (window.App) window.App.setCandidateName(candidateName);

      // Switch to chat view
      showChatSection();

      // Clear existing messages
      Chat.clearMessages();

      // Add opening message
      Chat.addAIMessage(data.message, { isOpening: true });

      // Update UI state
      updateInterviewUI();
      startTimer();

      // Show interviewer's profile data subtly
      if (data.profile) {
        updateProfileStats(data.profile);
      }

      // Enable/disable buttons
      setButtonState(true);

      hideLoading();
      showToast('Interview started! Good luck! 🎯', 'success');

    } catch (err) {
      hideLoading();
      showToast(err.message || 'Failed to start interview', 'error');
      console.error('[Interview Start Error]:', err);
    }
  }

  // ─── Submit Answer ────────────────────────────────────────────────────────
  async function submitAnswer() {
    if (!isActive || isProcessing) return;

    const textarea = getEl('answer-input');
    const answer   = textarea?.value?.trim();

    if (!answer) {
      showToast('Please type an answer before sending.', 'warning');
      textarea?.focus();
      return;
    }

    isProcessing = true;
    disableInput();

    // Show user's message
    const userMsgEl = Chat.addUserMessage(answer);
    textarea.value = '';
    Utils.autoResize(textarea);
    updateCharCount();

    // Show typing indicator
    Chat.showTyping('Processing your answer...');

    try {
      const data = await apiRequest('/api/interview/answer', {
        method: 'POST',
        body: JSON.stringify({ answer }),
      });

      Chat.hideTyping();

      // Show feedback on the user's message
      if (data.evaluation && userMsgEl) {
        Chat.addFeedbackCard(data.evaluation, userMsgEl.querySelector('.message-body'));
      }

      // Brief pause before next question
      await delay(600);

      // Show next question
      Chat.addAIMessage(data.nextQuestion, {
        questionNumber: data.questionNumber,
        difficulty:     data.difficulty,
      });

      questionCount  = data.questionNumber;
      currentDiff    = data.difficulty;

      // Update UI
      updateQuestionCounter(questionCount);
      updateDifficultyBadge(currentDiff);
      updateProgress();

    } catch (err) {
      Chat.hideTyping();
      showToast(err.message || 'Failed to process answer. Please try again.', 'error');
      console.error('[Submit Answer Error]:', err);
    } finally {
      isProcessing = false;
      enableInput();
    }
  }

  // ─── Get Hint ─────────────────────────────────────────────────────────────
  async function getHint() {
    const modal     = getEl('hint-modal');
    const modalBody = getEl('hint-modal-body');

    if (modal) modal.style.display = 'flex';
    if (modalBody) {
      modalBody.innerHTML = `
        <div class="hint-loading">
          <div class="loader-ring"></div>
          <p>Generating personalized answer guide...</p>
        </div>
      `;
    }

    try {
      const data = await apiRequest('/api/interview/hint', { method: 'POST' });

      if (!data.hint || !modalBody) return;

      const { hint } = data;
      const starSection = hint.starVersion && hint.starVersion.toLowerCase() !== 'not applicable'
        ? `
          <div class="hint-section">
            <p class="hint-section-title">⭐ STAR Format</p>
            <div class="star-box">
              ${formatSTAR(hint.starVersion)}
            </div>
          </div>
        ` : '';

      modalBody.innerHTML = `
        <div class="hint-question">"${Utils.escapeHtml(data.question)}"</div>

        <div class="hint-section">
          <p class="hint-section-title">💡 Suggested Answer</p>
          <div class="hint-answer">${Utils.renderMarkdown(hint.suggestedAnswer || '')}</div>
        </div>

        <div class="hint-section">
          <p class="hint-section-title">🎯 Key Points to Cover</p>
          <ul class="hint-list">
            ${(hint.keyPoints || []).map(p => `<li>${Utils.escapeHtml(p)}</li>`).join('')}
          </ul>
        </div>

        <div class="hint-section">
          <p class="hint-section-title">👔 What the Interviewer Expects</p>
          <ul class="hint-list">
            ${(hint.interviewerExpects || []).map(e => `<li>${Utils.escapeHtml(e)}</li>`).join('')}
          </ul>
        </div>

        <div class="hint-section">
          <p class="hint-section-title">🔑 Best Keywords to Use</p>
          <div class="keyword-cloud">
            ${(hint.bestKeywords || []).map(k => `<span class="keyword-pill">${Utils.escapeHtml(k)}</span>`).join('')}
          </div>
        </div>

        <div class="hint-section">
          <p class="hint-section-title">⚠️ Mistakes to Avoid</p>
          <ul class="hint-list">
            ${(hint.mistakesToAvoid || []).map(m => `<li>${Utils.escapeHtml(m)}</li>`).join('')}
          </ul>
        </div>

        ${starSection}

        <div class="hint-section">
          <p class="hint-section-title">🔄 Alternative Approach</p>
          <div class="hint-answer" style="background:rgba(62,207,207,0.06);border-color:rgba(62,207,207,0.2);">
            ${Utils.escapeHtml(hint.alternativeAnswer || '')}
          </div>
        </div>
      `;
    } catch (err) {
      if (modalBody) {
        modalBody.innerHTML = `<p style="color:var(--danger);text-align:center;padding:20px;">${Utils.escapeHtml(err.message)}</p>`;
      }
    }
  }

  function formatSTAR(text) {
    if (!text) return '';
    return text
      .split('|')
      .map(part => {
        const colonIdx = part.indexOf('-');
        if (colonIdx === -1) return `<span>${Utils.escapeHtml(part.trim())}</span>`;
        const label = part.substring(0, colonIdx).trim();
        const value = part.substring(colonIdx + 1).trim();
        return `<div style="margin-bottom:8px;"><strong>${Utils.escapeHtml(label)}</strong> — ${Utils.escapeHtml(value)}</div>`;
      })
      .join('');
  }

  // ─── Skip Question ────────────────────────────────────────────────────────
  async function skipQuestion() {
    if (!isActive || isProcessing) return;
    await submitAnswer.call(null, '[Skipped]');
  }

  // ─── End Interview ────────────────────────────────────────────────────────
  async function endInterview() {
    if (!isActive) return;

    const confirmed = confirm('Are you sure you want to end the interview? Your progress will be saved.');
    if (!confirmed) return;

    try {
      await apiRequest('/api/interview/end', { method: 'POST' });
    } catch {}

    stopTimer();
    isActive = false;

    Chat.addSystemNotice('Interview ended. Generating your report...', 'info');

    setButtonState(false);
    updateInterviewerStatus(false);

    // Auto-generate report
    await Report.generate();
  }

  // ─── Timer ───────────────────────────────────────────────────────────────
  function startTimer() {
    clearInterval(timerInterval);
    elapsedSeconds = 0;
    updateTimerDisplay();

    timerInterval = setInterval(() => {
      elapsedSeconds++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateTimerDisplay() {
    const el = getEl('stat-timer');
    if (el) el.textContent = formatTime(elapsedSeconds);
  }

  // ─── UI Update Helpers ────────────────────────────────────────────────────
  function showChatSection() {
    getEl('welcome-screen').style.display = 'none';
    getEl('report-section').style.display = 'none';
    getEl('chat-section').style.display   = 'flex';
    getEl('interview-stats').style.display = 'grid';
  }

  function updateInterviewUI() {
    updateQuestionCounter(0);
    updateDifficultyBadge('easy');
    updateProgress();
    updateInterviewerStatus(true);

    const statQuestions = getEl('stat-questions');
    if (statQuestions) statQuestions.textContent = '0';
  }

  function updateQuestionCounter(count) {
    const counterEl  = getEl('question-counter');
    const statEl     = getEl('stat-questions');
    const progressEl = getEl('progress-bar');

    if (counterEl) counterEl.textContent = `Q: ${count}`;
    if (statEl)    statEl.textContent    = count;
  }

  function updateDifficultyBadge(diff) {
    const badge   = getEl('difficulty-badge');
    const statDiff = getEl('stat-difficulty');
    if (badge) {
      badge.textContent = Utils.capitalize(diff);
      badge.className   = `difficulty-badge ${diff.toLowerCase()}`;
    }
    if (statDiff) statDiff.textContent = Utils.capitalize(diff);
  }

  function updateProgress() {
    const bar = getEl('progress-bar');
    if (!bar) return;
    // Progress based on question count (max ~20 questions)
    const pct = Math.min((questionCount / 20) * 100, 95);
    bar.style.width = `${pct}%`;
  }

  function updateInterviewerStatus(active) {
    const statusEl = getEl('interviewer-status');
    if (!statusEl) return;
    const dot  = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text') || statusEl;
    if (dot) {
      dot.className = `status-dot ${active ? 'active' : ''}`;
    }
    if (statusEl) {
      statusEl.innerHTML = `
        <span class="status-dot ${active ? 'active' : ''}" aria-hidden="true"></span>
        ${active ? 'Interview in Progress' : 'Interview Ended'}
      `;
    }
  }

  function updateProfileStats(profile) {
    // Already handled by Upload module
  }

  function disableInput() {
    const textarea = getEl('answer-input');
    const sendBtn  = getEl('send-btn');
    if (textarea) textarea.disabled = true;
    if (sendBtn)  sendBtn.disabled  = true;
  }

  function enableInput() {
    const textarea = getEl('answer-input');
    const sendBtn  = getEl('send-btn');
    if (textarea) { textarea.disabled = false; textarea.focus(); }
    if (sendBtn)  sendBtn.disabled  = false;
  }

  function updateCharCount() {
    const counter  = getEl('char-count');
    const textarea = getEl('answer-input');
    if (counter && textarea) counter.textContent = `${textarea.value.length} / 5000`;
  }

  function setButtonState(active) {
    const restartBtn = getEl('restart-btn');
    const reportBtn  = getEl('report-btn');
    const startBtn   = getEl('start-interview-btn');
    const endBtn     = getEl('end-interview-btn');

    if (restartBtn) restartBtn.disabled = false;
    if (reportBtn)  reportBtn.disabled  = !active && questionCount === 0;
    if (startBtn)   startBtn.disabled   = active;

    // Show/hide end button
    if (endBtn) endBtn.style.display = active ? 'flex' : 'none';
  }

  // ─── Restart ─────────────────────────────────────────────────────────────
  async function restart() {
    const confirmed = confirm('Restart interview? This will clear the current session.');
    if (!confirmed) return;

    stopTimer();
    isActive      = false;
    questionCount = 0;
    currentDiff   = 'easy';
    isProcessing  = false;
    elapsedSeconds = 0;

    Chat.clearMessages();

    try {
      await apiRequest('/api/session/reset', { method: 'POST' });
    } catch {}

    Upload.resetUploadState();
    showWelcomeScreen();

    const startBtn = getEl('start-interview-btn');
    const restartBtn = getEl('restart-btn');
    if (startBtn)   startBtn.disabled   = true;
    if (restartBtn) restartBtn.disabled = true;

    getEl('interview-stats').style.display = 'none';
    showToast('Session reset. Upload documents to start again.', 'info');
  }

  function showWelcomeScreen() {
    getEl('chat-section').style.display   = 'none';
    getEl('report-section').style.display = 'none';
    getEl('welcome-screen').style.display = 'flex';
  }

  // ─── Getters ──────────────────────────────────────────────────────────────
  function getIsActive()      { return isActive; }
  function getQuestionCount() { return questionCount; }
  function getCandidateName() { return candidateName; }
  function getElapsedSeconds(){ return elapsedSeconds; }

  // ─── Helper ───────────────────────────────────────────────────────────────
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  return {
    start,
    submitAnswer,
    getHint,
    skipQuestion,
    endInterview,
    restart,
    showWelcomeScreen,
    showChatSection,
    getIsActive,
    getQuestionCount,
    getCandidateName,
    getElapsedSeconds,
    updateCharCount,
    disableInput,
    enableInput,
  };
})();

window.Interview = Interview;
