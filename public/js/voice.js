/**
 * voice.js — Speech-to-Text and Text-to-Speech using Web Speech API
 */

const Voice = (() => {
  const { showToast } = Utils;

  let recognition = null;
  let synthesis = window.speechSynthesis;
  let isListening = false;
  let isSpeaking = false;
  let voiceEnabled = false;
  let preferredVoice = null;

  // ─── Initialize Speech Recognition ──────────────────────────────────────
  function initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;
    return rec;
  }

  // ─── Load Preferred Voice ────────────────────────────────────────────────
  function loadPreferredVoice() {
    const voices = synthesis.getVoices();
    // Prefer natural-sounding English voices
    const preferred = [
      'Google UK English Male',
      'Google US English',
      'Microsoft David Desktop',
      'Microsoft Mark Desktop',
      'Alex',
    ];
    for (const name of preferred) {
      const found = voices.find(v => v.name === name);
      if (found) { preferredVoice = found; return; }
    }
    // Fallback: any English voice
    preferredVoice = voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
  }

  if (synthesis) {
    synthesis.addEventListener('voiceschanged', loadPreferredVoice);
    loadPreferredVoice();
  }

  // ─── Text-to-Speech ───────────────────────────────────────────────────────
  function speak(text, onEnd = null) {
    if (!synthesis || !voiceEnabled) {
      if (onEnd) onEnd();
      return;
    }

    synthesis.cancel(); // Stop any ongoing speech

    // Clean text for speech (remove markdown)
    const cleanText = text
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/[>*_~`]/g, '')
      .substring(0, 500); // Limit length

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate  = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 0.9;
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => { isSpeaking = true; };
    utterance.onend   = () => {
      isSpeaking = false;
      if (onEnd) onEnd();
    };
    utterance.onerror = (e) => {
      isSpeaking = false;
      if (onEnd) onEnd();
    };

    synthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (synthesis) synthesis.cancel();
    isSpeaking = false;
  }

  // ─── Speech-to-Text ───────────────────────────────────────────────────────
  function startListening(onResult, onError) {
    if (isListening) return;

    recognition = initRecognition();
    if (!recognition) {
      showToast('Speech recognition not supported in this browser. Try Chrome.', 'warning');
      if (onError) onError('not_supported');
      return;
    }

    const voiceOverlay = document.getElementById('voice-overlay');
    const voiceStopBtn = document.getElementById('voice-stop-btn');
    const textarea    = document.getElementById('answer-input');

    let finalTranscript = '';
    let interimTranscript = '';

    recognition.onstart = () => {
      isListening = true;
      if (voiceOverlay) voiceOverlay.style.display = 'flex';
      if (voiceStopBtn) voiceStopBtn.onclick = stopListening;
    };

    recognition.onresult = (e) => {
      interimTranscript = '';
      finalTranscript   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }
      // Show interim in textarea
      if (textarea) {
        textarea.value = finalTranscript || interimTranscript;
        Utils.autoResize(textarea);
        updateCharCount(textarea);
      }
    };

    recognition.onend = () => {
      isListening = false;
      if (voiceOverlay) voiceOverlay.style.display = 'none';
      if (finalTranscript && onResult) onResult(finalTranscript.trim());
    };

    recognition.onerror = (e) => {
      isListening = false;
      if (voiceOverlay) voiceOverlay.style.display = 'none';
      const msgs = {
        'not-allowed': 'Microphone access denied. Please allow microphone access.',
        'network': 'Network error during voice recognition.',
        'no-speech': 'No speech detected. Please try again.',
        'audio-capture': 'No microphone found.',
      };
      const msg = msgs[e.error] || `Voice error: ${e.error}`;
      showToast(msg, 'error');
      if (onError) onError(e.error);
    };

    recognition.start();
  }

  function stopListening() {
    if (recognition && isListening) {
      recognition.stop();
    }
    isListening = false;
    const voiceOverlay = document.getElementById('voice-overlay');
    if (voiceOverlay) voiceOverlay.style.display = 'none';
  }

  function updateCharCount(textarea) {
    const counter = document.getElementById('char-count');
    if (counter) counter.textContent = `${textarea.value.length} / 5000`;
  }

  // ─── Toggle Voice Mode ───────────────────────────────────────────────────
  function toggleVoiceMode() {
    voiceEnabled = !voiceEnabled;
    const btn  = document.getElementById('voice-toggle-btn');
    const icon = btn;
    if (voiceEnabled) {
      icon.classList.add('active');
      showToast('Voice mode enabled — AI will speak questions', 'info');
    } else {
      icon.classList.remove('active');
      stopSpeaking();
      showToast('Voice mode disabled', 'info');
    }
    return voiceEnabled;
  }

  function isVoiceEnabled() { return voiceEnabled; }
  function isSpeakingNow()  { return isSpeaking; }
  function isListeningNow() { return isListening; }

  return {
    speak,
    stopSpeaking,
    startListening,
    stopListening,
    toggleVoiceMode,
    isVoiceEnabled,
    isSpeakingNow,
    isListeningNow,
  };
})();

window.Voice = Voice;
