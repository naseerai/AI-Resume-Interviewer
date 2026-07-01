/**
 * report.js — Interview Report Generation and PDF Export
 */

const Report = (() => {
  const { apiRequest, showToast, showLoading, hideLoading, escapeHtml, capitalize, scoreToColor } = Utils;

  let reportData = null;
  let profileData = null;

  // ─── Generate Report ──────────────────────────────────────────────────────
  async function generate() {
    showLoading('Generating your comprehensive interview report...');

    try {
      const data = await apiRequest('/api/report/generate', { method: 'POST' });

      reportData  = data.report;
      profileData = data.profile;

      hideLoading();

      // Switch to report view
      showReportSection();
      renderReport(data);

      // Enable report button
      const reportBtn = document.getElementById('report-btn');
      if (reportBtn) reportBtn.disabled = false;

      showToast('Report generated successfully! 🎉', 'success');

    } catch (err) {
      hideLoading();
      showToast(err.message || 'Failed to generate report.', 'error');
      console.error('[Report Generation Error]:', err);
    }
  }

  // ─── Show Report Section ──────────────────────────────────────────────────
  function showReportSection() {
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('chat-section').style.display   = 'none';
    document.getElementById('report-section').style.display = 'block';

    // Update progress bar to 100%
    const pb = document.getElementById('progress-bar');
    if (pb) pb.style.width = '100%';
  }

  // ─── Render Full Report ───────────────────────────────────────────────────
  function renderReport(responseData) {
    const container = document.getElementById('report-container');
    if (!container) return;

    const { report, profile, interviewStats } = responseData;
    if (!report) { container.innerHTML = '<p style="color:var(--danger);">Report data not available.</p>'; return; }

    // Hiring verdict setup
    const verdictClass = getVerdictClass(report.hiringRecommendation);
    const verdictEmoji = getVerdictEmoji(report.hiringRecommendation);

    // Score ring SVG generator
    const ring = (score, id, label) => {
      const radius = 28;
      const circ   = 2 * Math.PI * radius;
      const dash   = (score / 100) * circ;
      const color  = scoreToColor(score);
      return `
        <div class="score-card">
          <div class="score-ring" aria-label="${label}: ${score}%">
            <svg width="76" height="76" viewBox="0 0 76 76">
              <defs>
                <linearGradient id="sg_${id}" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="${color}"/>
                  <stop offset="100%" stop-color="${color}99"/>
                </linearGradient>
              </defs>
              <circle class="score-ring-bg" cx="38" cy="38" r="${radius}" fill="none" stroke="var(--border)" stroke-width="6"/>
              <circle class="score-ring-fill" cx="38" cy="38" r="${radius}" fill="none"
                stroke="url(#sg_${id})" stroke-width="6" stroke-linecap="round"
                stroke-dasharray="${dash} ${circ}" style="transform:rotate(-90deg);transform-origin:center;"/>
              <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
                font-family="Inter" font-size="13" font-weight="700" fill="${color}">${score}</text>
            </svg>
          </div>
          <p class="score-card-label">${label}</p>
        </div>
      `;
    };

    // Duration formatting
    const mins = Math.floor((interviewStats?.duration || 0) / 60);
    const secs = (interviewStats?.duration || 0) % 60;

    container.innerHTML = `
      <!-- Report Header -->
      <div class="report-header">
        <h1 class="report-title">Interview Report</h1>
        <p class="report-subtitle">${escapeHtml(profile?.candidateName || 'Candidate')} · ${escapeHtml(profile?.currentRole || 'Position')} · ${capitalize(profile?.experienceLevel || '')}</p>
        <div class="report-meta">
          <span class="report-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"/></svg>
            <strong>${escapeHtml(profile?.educationLevel || '—')}</strong> from ${escapeHtml(profile?.college || '—')}
          </span>
          <span class="report-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <strong>${mins}m ${secs}s</strong> Interview Duration
          </span>
          <span class="report-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            <strong>${interviewStats?.totalQuestions || 0}</strong> Questions Answered
          </span>
        </div>
      </div>

      <!-- Hiring Verdict Banner -->
      <div class="verdict-banner ${verdictClass}" role="alert">
        <span class="verdict-icon" aria-hidden="true">${verdictEmoji}</span>
        <div class="verdict-content">
          <h2 class="verdict-title">${escapeHtml(report.hiringRecommendation || 'Assessment Complete')}</h2>
          <p class="verdict-desc">${escapeHtml(report.verdictExplanation || report.finalVerdict || '')}</p>
        </div>
      </div>

      <!-- Score Cards Grid -->
      <div class="score-cards-grid" role="list" aria-label="Score summary">
        ${ring(report.overallScore      || 0, 'overall',  'Overall')}
        ${ring(report.technicalScore    || 0, 'tech',     'Technical')}
        ${ring(report.hrScore           || 0, 'hr',       'HR')}
        ${ring(report.communicationScore|| 0, 'comm',     'Communication')}
        ${ring(report.confidenceScore   || 0, 'conf',     'Confidence')}
        ${ring(report.jdMatchScore      || 0, 'jd',       'JD Match')}
        ${ring(report.resumeMatchScore  || 0, 'resume',   'Resume Match')}
        ${ring(report.hiringProbability || 0, 'hiring',   'Hire Chance')}
      </div>

      <!-- Hiring Probability Bar -->
      <div class="report-card" style="margin-bottom:16px;">
        <p class="report-card-title">📊 Hiring Probability</p>
        <div class="hiring-bar-wrap" role="progressbar" aria-valuenow="${report.hiringProbability}" aria-valuemin="0" aria-valuemax="100">
          <div class="hiring-bar" style="width:${report.hiringProbability || 0}%; background:${scoreToColor(report.hiringProbability || 0)};"></div>
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);text-align:center;">${report.hiringProbability}% probability of being selected based on interview performance</p>
      </div>

      <!-- Strengths & Weaknesses -->
      <div class="report-grid">
        <div class="report-card">
          <p class="report-card-title">💪 Strengths</p>
          <div class="tag-cloud">
            ${(report.strengths || []).map(s => `<span class="tag strength" role="listitem">${escapeHtml(s)}</span>`).join('')}
          </div>
        </div>
        <div class="report-card">
          <p class="report-card-title">🔧 Weaknesses</p>
          <div class="tag-cloud">
            ${(report.weaknesses || []).map(w => `<span class="tag weakness" role="listitem">${escapeHtml(w)}</span>`).join('')}
          </div>
        </div>
      </div>

      <!-- Missing Skills -->
      <div class="report-card" style="margin-bottom:16px;">
        <p class="report-card-title">⚠️ Missing Skills / Gaps</p>
        <div class="tag-cloud">
          ${(report.missingSkills || []).map(s => `<span class="tag missing" role="listitem">${escapeHtml(s)}</span>`).join('')}
        </div>
      </div>

      <!-- Topics to Study -->
      <div class="report-card" style="margin-bottom:16px;">
        <p class="report-card-title">📚 Topics to Study</p>
        <ul class="study-list" role="list">
          ${(report.topicsToStudy || []).map(t => `
            <li role="listitem">
              <span class="study-priority ${escapeHtml(t.priority || 'Medium')}">${escapeHtml(t.priority || 'Medium')}</span>
              <div class="study-info">
                <span class="study-topic">${escapeHtml(t.topic || t)}</span>
                <span class="study-resource">${escapeHtml(t.resources || 'Search online resources')}</span>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>

      <!-- Certifications & Projects -->
      <div class="report-grid">
        <div class="report-card">
          <p class="report-card-title">🏆 Recommended Certifications</p>
          <ul class="cert-list" role="list">
            ${(report.recommendedCertifications || []).map(c => `
              <li role="listitem">
                <span class="cert-name">${escapeHtml(c.name || c)}</span>
                <span class="cert-meta">${escapeHtml(c.platform || '')}${c.relevance ? ` · ${c.relevance}` : ''}</span>
              </li>
            `).join('')}
          </ul>
        </div>
        <div class="report-card">
          <p class="report-card-title">🚀 Recommended Projects to Build</p>
          <ul class="project-list" role="list">
            ${(report.recommendedProjects || []).map(p => `
              <li role="listitem">
                <span class="cert-name">${escapeHtml(typeof p === 'string' ? p : (p.name || p))}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>

      <!-- Most Asked Questions -->
      <div class="report-card" style="margin-bottom:16px;">
        <p class="report-card-title">❓ Most Asked Question Types in This Interview</p>
        <div class="tag-cloud">
          ${(report.mostAskedQuestions || []).map(q => `<span class="tag topic" role="listitem">${escapeHtml(q)}</span>`).join('')}
        </div>
      </div>

      <!-- Interview Summary & Areas of Improvement -->
      <div class="report-grid">
        <div class="report-card">
          <p class="report-card-title">📋 Interview Summary</p>
          <p class="summary-text">${escapeHtml(report.interviewSummary || '')}</p>
        </div>
        <div class="report-card">
          <p class="report-card-title">🎯 Areas of Improvement</p>
          <ul class="step-list" role="list">
            ${(report.areasOfImprovement || []).map(a => `
              <li role="listitem" style="border-color:var(--border);">
                <span style="color:var(--warning);font-size:0.9rem;" aria-hidden="true">→</span>
                <span style="font-size:0.82rem;color:var(--text-secondary);">${escapeHtml(a)}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>

      <!-- Next Steps -->
      <div class="report-card" style="margin-bottom:16px;">
        <p class="report-card-title">✅ Recommended Next Steps</p>
        <ul class="step-list" role="list">
          ${(report.nextSteps || []).map((s, i) => `
            <li role="listitem">
              <span style="background:var(--grad-primary);color:white;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;flex-shrink:0;" aria-hidden="true">${i + 1}</span>
              <span style="font-size:0.82rem;color:var(--text-secondary);">${escapeHtml(s)}</span>
            </li>
          `).join('')}
        </ul>
      </div>

      <!-- Final Verdict -->
      <div class="report-card" style="margin-bottom:28px;border-color:var(--border-accent);">
        <p class="report-card-title">🎓 Final Verdict</p>
        <p class="summary-text" style="color:var(--text-primary);font-size:0.9rem;line-height:1.75;">${escapeHtml(report.finalVerdict || '')}</p>
      </div>

      <!-- Report Actions -->
      <div class="report-actions">
        <button class="report-action-btn primary" id="export-pdf-btn" onclick="Report.exportPDF()" aria-label="Download report as PDF">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Download PDF Report
        </button>
        <button class="report-action-btn secondary" onclick="Interview.start()" aria-label="Start a new interview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
          </svg>
          New Interview
        </button>
        <button class="report-action-btn secondary" onclick="Report.showChat()" aria-label="View interview chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          View Chat
        </button>
      </div>
    `;

    // Animate score bars after render
    setTimeout(() => {
      const hiringBar = container.querySelector('.hiring-bar');
      if (hiringBar) hiringBar.style.width = `${report.hiringProbability || 0}%`;
    }, 100);
  }

  // ─── Verdict Helpers ──────────────────────────────────────────────────────
  function getVerdictClass(rec = '') {
    const r = rec.toLowerCase();
    if (r.includes('strong hire') || r.includes('hire')) return 'hire';
    if (r.includes('borderline'))                        return 'borderline';
    return 'no-hire';
  }

  function getVerdictEmoji(rec = '') {
    const r = rec.toLowerCase();
    if (r.includes('strong hire')) return '🌟';
    if (r.includes('hire'))        return '✅';
    if (r.includes('borderline'))  return '⚖️';
    return '❌';
  }

  // ─── Export PDF ───────────────────────────────────────────────────────────
  function exportPDF() {
    const container = document.getElementById('report-container');
    if (!container) { showToast('No report to export', 'warning'); return; }
    if (typeof html2pdf === 'undefined') { showToast('PDF library not loaded. Please refresh.', 'error'); return; }

    showToast('Generating PDF...', 'info', 2000);

    const opts = {
      margin:      [10, 10, 10, 10],
      filename:    `interview-report-${Date.now()}.pdf`,
      image:       { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#0a0a0f' },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] },
    };

    html2pdf().set(opts).from(container).save()
      .then(() => showToast('PDF exported successfully! 📄', 'success'))
      .catch(() => showToast('PDF export failed. Try again.', 'error'));
  }

  // ─── Show Chat from Report ────────────────────────────────────────────────
  function showChat() {
    document.getElementById('report-section').style.display = 'none';
    document.getElementById('chat-section').style.display   = 'flex';
  }

  // ─── View Report (from sidebar button) ───────────────────────────────────
  async function view() {
    if (reportData) {
      showReportSection();
      return;
    }
    // Try to load cached report
    try {
      const data = await apiRequest('/api/report/cached');
      if (data.report) {
        reportData = data.report;
        showReportSection();
        renderReport({ report: data.report, profile: data.profile, interviewStats: {} });
      }
    } catch {
      await generate();
    }
  }

  return {
    generate,
    view,
    exportPDF,
    showChat,
    showReportSection,
  };
})();

window.Report = Report;
