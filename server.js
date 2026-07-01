/**
 * AI Resume Interviewer - Main Server
 * Node.js + Express backend with Gemini AI integration
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Route imports
const uploadRoutes = require('./server/routes/upload');
const interviewRoutes = require('./server/routes/interview');
const reportRoutes = require('./server/routes/report');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory session store (keyed by sessionId) ───────────────────────────
const sessions = new Map();

// Session middleware - creates or retrieves session
app.use((req, res, next) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId && sessions.has(sessionId)) {
    req.session = sessions.get(sessionId);
  } else {
    const newId = uuidv4();
    const newSession = {
      id: newId,
      resumeText: null,
      jdText: null,
      candidateProfile: null,
      interviewHistory: [],
      questionCount: 0,
      currentDifficulty: 'easy',
      askedQuestions: new Set(),
      startTime: null,
      isInterviewActive: false,
    };
    sessions.set(newId, newSession);
    req.session = newSession;
    res.setHeader('X-Session-Id', newId);
  }
  next();
});

// Expose session store to routes
app.set('sessions', sessions);

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/upload', uploadRoutes);
app.use('/api/interview', interviewRoutes);
app.use('/api/report', reportRoutes);

// Session management endpoints
app.get('/api/session', (req, res) => {
  res.json({
    sessionId: req.session.id,
    hasResume: !!req.session.resumeText,
    hasJD: !!req.session.jdText,
    isInterviewActive: req.session.isInterviewActive,
    questionCount: req.session.questionCount,
  });
});

app.post('/api/session/reset', (req, res) => {
  const sessionId = req.session.id;
  const resetSession = {
    id: sessionId,
    resumeText: null,
    jdText: null,
    candidateProfile: null,
    interviewHistory: [],
    questionCount: 0,
    currentDifficulty: 'easy',
    askedQuestions: new Set(),
    startTime: null,
    isInterviewActive: false,
  };
  sessions.set(sessionId, resetSession);
  res.json({ success: true, message: 'Session reset successfully.' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 AI Resume Interviewer running at http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔑 Gemini API: ${process.env.GEMINI_API_KEY ? 'Configured ✓' : 'MISSING ✗'}\n`);
});

module.exports = app;
