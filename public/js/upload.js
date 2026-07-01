/**
 * upload.js — File upload handling with progress and preview
 */

const Upload = (() => {
  const { apiRequest, showToast, formatFileSize } = Utils;

  let resumeUploaded = false;
  let jdUploaded = false;
  let analysisProfile = null;

  // ─── Setup Upload Listeners ────────────────────────────────────────────────
  function init() {
    // Resume: file input
    const resumeInput = document.getElementById('resume-file-input');
    resumeInput?.addEventListener('change', (e) => {
      if (e.target.files[0]) handleUpload(e.target.files[0], 'resume');
    });

    // Resume: drag & drop
    setupDragDrop('resume-upload-card', 'resume-file-input', 'resume');

    // JD: paste textarea character counter
    const jdTextarea = document.getElementById('jd-paste-input');
    const jdCharCount = document.getElementById('jd-char-count');
    jdTextarea?.addEventListener('input', () => {
      const len = jdTextarea.value.length;
      if (jdCharCount) jdCharCount.textContent = `${len.toLocaleString()} / 20,000`;
      // Turn counter red when close to limit
      jdCharCount.style.color = len > 18000 ? 'var(--danger)' : '';
    });

    // JD: Save button
    document.getElementById('jd-save-btn')?.addEventListener('click', saveJD);

    // JD: Ctrl+Shift+J shortcut
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        saveJD();
      }
    });
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────────────
  function setupDragDrop(cardId, inputId, type) {
    const card = document.getElementById(cardId);
    if (!card) return;

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.style.borderColor = 'var(--accent)';
      card.style.background  = 'rgba(108,99,255,0.05)';
    });
    card.addEventListener('dragleave', () => {
      card.style.borderColor = '';
      card.style.background  = '';
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.style.borderColor = '';
      card.style.background  = '';
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file, type);
    });
  }

  // ─── Handle File Upload ────────────────────────────────────────────────────
  async function handleUpload(file, type) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      showToast(`File too large. Max size is 10MB. Your file: ${formatFileSize(file.size)}`, 'error');
      return;
    }

    const formData = new FormData();
    formData.append(type, file);

    const endpoint = type === 'resume' ? '/api/upload/resume' : '/api/upload/jd';
    const cardId   = type === 'resume' ? 'resume-upload-card' : 'jd-upload-card';
    const statusId = type === 'resume' ? 'resume-status' : 'jd-status';
    const previewId = type === 'resume' ? 'resume-preview' : 'jd-preview';
    const btnId    = type === 'resume' ? 'resume-upload-btn' : 'jd-upload-btn';

    const card    = document.getElementById(cardId);
    const status  = document.getElementById(statusId);
    const preview = document.getElementById(previewId);
    const btn     = document.getElementById(btnId);

    // Show uploading state
    if (btn) {
      btn.innerHTML = `<span class="loader-ring small" style="border-width:2px;width:12px;height:12px;margin-right:4px;"></span> Uploading...`;
      btn.style.pointerEvents = 'none';
    }
    if (status) { status.textContent = ''; status.className = 'upload-status'; }

    try {
      const data = await apiRequest(endpoint, {
        method: 'POST',
        body: formData,
        headers: {}, // Let browser set Content-Type for FormData
      });

      // Success state
      if (card)   { card.classList.add('success'); }
      if (status) {
        status.className = 'upload-status success';
        status.textContent = '✓';
        status.title = 'Uploaded successfully';
      }

      // Show preview
      if (preview) {
        preview.classList.add('visible');
        preview.innerHTML = `
          <span class="file-name">📄 ${Utils.escapeHtml(file.name)}</span>
          <span class="file-info">${formatFileSize(file.size)} • ${data.textLength?.toLocaleString()} characters extracted</span>
          ${data.preview ? `<span style="margin-top:6px;display:block;color:var(--text-muted);font-size:0.68rem;line-height:1.4;border-top:1px solid var(--border);padding-top:6px;margin-top:4px;">${Utils.escapeHtml(data.preview.substring(0, 160))}...</span>` : ''}
        `;
      }

      // Reset button
      if (btn) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> Uploaded`;
        btn.style.pointerEvents = '';
        btn.style.background = 'rgba(34,197,94,0.15)';
        btn.style.borderColor = 'rgba(34,197,94,0.4)';
        btn.style.color = 'var(--success)';
      }

      if (type === 'resume') resumeUploaded = true;
      if (type === 'jd')     jdUploaded     = true;

      showToast(`${type === 'resume' ? 'Resume' : 'Job description'} uploaded successfully!`, 'success');

      // Handle profile data if generated
      if (data.profileGenerated && data.profile) {
        // Fetch full profile
        await fetchAndDisplayProfile();
      }

      // Update interview button state
      updateStartButton();

    } catch (err) {
      console.error(`[Upload ${type} Error]:`, err);
      showToast(err.message || 'Upload failed. Please try again.', 'error');

      if (status) { status.className = 'upload-status error'; status.textContent = '✗'; }
      if (btn) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke-linecap="round"/></svg> Retry`;
        btn.style.pointerEvents = '';
      }
    }
  }

  // ─── Save Pasted JD ──────────────────────────────────────────────────────
  async function saveJD() {
    const textarea = document.getElementById('jd-paste-input');
    const saveBtn  = document.getElementById('jd-save-btn');
    const status   = document.getElementById('jd-status');
    const card     = document.getElementById('jd-upload-card');
    const preview  = document.getElementById('jd-preview');

    const text = textarea?.value?.trim();

    if (!text || text.length < 30) {
      showToast('Please paste a job description (at least 30 characters).', 'warning');
      textarea?.focus();
      return;
    }

    // Loading state
    if (saveBtn) {
      saveBtn.innerHTML = `<span class="loader-ring small" style="border-width:2px;width:12px;height:12px;margin-right:4px;"></span> Saving...`;
      saveBtn.disabled = true;
    }

    try {
      const data = await apiRequest('/api/upload/paste-jd', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });

      jdUploaded = true;

      // Success UI
      if (card)   card.classList.add('success');
      if (status) {
        status.className = 'upload-status success';
        status.textContent = '✓';
        status.title = 'JD saved';
      }
      if (preview) {
        preview.classList.add('visible');
        preview.innerHTML = `
          <span class="file-name">📋 Job Description saved</span>
          <span class="file-info">${text.length.toLocaleString()} characters</span>
          <span style="margin-top:5px;display:block;color:var(--text-muted);font-size:0.68rem;line-height:1.4;border-top:1px solid var(--border);padding-top:5px;">${Utils.escapeHtml(text.substring(0, 120))}…</span>
        `;
      }
      if (saveBtn) {
        saveBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> Saved`;
        saveBtn.style.background  = 'rgba(34,197,94,0.15)';
        saveBtn.style.borderColor = 'rgba(34,197,94,0.4)';
        saveBtn.style.color       = 'var(--success)';
        saveBtn.disabled = false;
      }

      showToast('Job description saved!', 'success');

      if (data.profileGenerated) await fetchAndDisplayProfile();
      updateStartButton();

    } catch (err) {
      showToast(err.message || 'Failed to save JD. Please try again.', 'error');
      if (status) { status.className = 'upload-status error'; status.textContent = '✗'; }
      if (saveBtn) {
        saveBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> Retry`;
        saveBtn.disabled = false;
      }
    }
  }

  // ─── Fetch and Display Candidate Profile ──────────────────────────────────
  async function fetchAndDisplayProfile() {
    try {
      const data = await apiRequest('/api/upload/status');
      if (data.hasProfile && data.profile) {
        analysisProfile = data.profile;
        displayProfileCard(data.profile);
      }
    } catch (err) {
      console.error('[Fetch Profile Error]:', err);
    }
  }

  // ─── Display Profile Card in Sidebar ──────────────────────────────────────
  function displayProfileCard(profile) {
    const card         = document.getElementById('profile-card');
    const nameEl       = document.getElementById('profile-name');
    const levelEl      = document.getElementById('profile-level');
    const avatarEl     = document.getElementById('profile-avatar');
    const jdMatchBar   = document.getElementById('jd-match-bar');
    const jdMatchVal   = document.getElementById('jd-match-val');
    const atsScoreBar  = document.getElementById('ats-score-bar');
    const atsScoreVal  = document.getElementById('ats-score-val');

    if (!card) return;

    if (nameEl)  nameEl.textContent  = profile.candidateName || 'Candidate';
    if (levelEl) levelEl.textContent = Utils.capitalize(profile.experienceLevel || 'Unknown') + ' Level';
    if (avatarEl) avatarEl.textContent = (profile.candidateName || 'C').charAt(0).toUpperCase();

    // Animate score bars
    const jd  = profile.jobMatchPercent || 0;
    const ats = profile.atsScore        || 0;
    if (jdMatchBar)  { setTimeout(() => { jdMatchBar.style.width  = `${jd}%`;  }, 100); }
    if (jdMatchVal)  jdMatchVal.textContent  = `${jd}%`;
    if (atsScoreBar) { setTimeout(() => { atsScoreBar.style.width = `${ats}%`; }, 200); }
    if (atsScoreVal) atsScoreVal.textContent = `${ats}%`;

    card.style.display = 'block';
    card.style.animation = 'fadeSlideIn 0.4s ease';

    // Show skills preview
    if (profile.technicalSkills?.length) {
      showToast(`Profile analyzed! ${jd}% JD match. Top skills: ${profile.technicalSkills.slice(0,3).join(', ')}`, 'success', 5000);
    }
  }

  // ─── Update Start Button State ────────────────────────────────────────────
  function updateStartButton() {
    const btn = document.getElementById('start-interview-btn');
    if (!btn) return;

    if (resumeUploaded && jdUploaded) {
      btn.disabled = false;
      btn.title = 'Start Interview (Ctrl+I)';
    }
  }

  // ─── Getters ──────────────────────────────────────────────────────────────
  function isResumeUploaded() { return resumeUploaded; }
  function isJDUploaded()     { return jdUploaded; }
  function getProfile()       { return analysisProfile; }

  function resetUploadState() {
    resumeUploaded = false;
    jdUploaded     = false;
    analysisProfile = null;

    // Reset UI — Resume
    const resumeCard    = document.getElementById('resume-upload-card');
    const resumeStatus  = document.getElementById('resume-status');
    const resumePreview = document.getElementById('resume-preview');
    const resumeBtn     = document.getElementById('resume-upload-btn');
    if (resumeCard)    resumeCard.classList.remove('success');
    if (resumeStatus)  { resumeStatus.className = 'upload-status'; resumeStatus.textContent = ''; }
    if (resumePreview) { resumePreview.classList.remove('visible'); resumePreview.innerHTML = ''; }
    if (resumeBtn)     {
      resumeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke-linecap="round" stroke-linejoin="round"/></svg> Upload Resume`;
      resumeBtn.style.background = resumeBtn.style.borderColor = resumeBtn.style.color = '';
    }

    // Reset UI — JD paste
    const jdCard     = document.getElementById('jd-upload-card');
    const jdStatus   = document.getElementById('jd-status');
    const jdPreview  = document.getElementById('jd-preview');
    const jdSaveBtn  = document.getElementById('jd-save-btn');
    const jdTextarea = document.getElementById('jd-paste-input');
    const jdCounter  = document.getElementById('jd-char-count');
    if (jdCard)     jdCard.classList.remove('success');
    if (jdStatus)   { jdStatus.className = 'upload-status'; jdStatus.textContent = ''; }
    if (jdPreview)  { jdPreview.classList.remove('visible'); jdPreview.innerHTML = ''; }
    if (jdTextarea) jdTextarea.value = '';
    if (jdCounter)  { jdCounter.textContent = '0 / 20,000'; jdCounter.style.color = ''; }
    if (jdSaveBtn)  {
      jdSaveBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> Save JD`;
      jdSaveBtn.style.background = jdSaveBtn.style.borderColor = jdSaveBtn.style.color = '';
      jdSaveBtn.disabled = false;
    }

    document.getElementById('profile-card').style.display = 'none';
    updateStartButton();
  }

  return {
    init,
    isResumeUploaded,
    isJDUploaded,
    getProfile,
    fetchAndDisplayProfile,
    displayProfileCard,
    resetUploadState,
    updateStartButton,
  };
})();

window.Upload = Upload;
