/**
 * Upload Routes
 * Handles resume and job description file uploads
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { extractText, validateResumeText, validateJDText, getPreview } = require('../services/parser');
const { analyzeCandidateProfile } = require('../services/gemini');

// Configure multer for in-memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
  ];
  const allowedExts = ['.pdf', '.docx', '.doc', '.txt'];
  const ext = require('path').extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: PDF, DOCX, TXT. Got: ${file.originalname}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  },
});

/**
 * POST /api/upload/resume
 * Upload and parse resume
 */
router.post('/resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded.' });
    }

    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    const isValid = validateResumeText(text);
    const preview = getPreview(text, 400);

    // Store in session
    req.session.resumeText = text;
    req.session.candidateProfile = null; // Reset profile on new upload

    // Auto-analyze if JD is already uploaded
    let profileGenerated = false;
    if (req.session.jdText) {
      try {
        req.session.candidateProfile = await analyzeCandidateProfile(text, req.session.jdText);
        profileGenerated = true;
      } catch (analyzeErr) {
        console.error('[Profile Analysis Error]:', analyzeErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Resume uploaded and parsed successfully.',
      filename: req.file.originalname,
      fileSize: req.file.size,
      textLength: text.length,
      preview,
      isValidResume: isValid,
      profileGenerated,
      profile: profileGenerated ? {
        candidateName: req.session.candidateProfile?.candidateName,
        jobMatchPercent: req.session.candidateProfile?.jobMatchPercent,
        atsScore: req.session.candidateProfile?.atsScore,
      } : null,
    });
  } catch (err) {
    console.error('[Upload Resume Error]:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/upload/jd
 * Upload and parse job description
 */
router.post('/jd', upload.single('jd'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No job description file uploaded.' });
    }

    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    const isValid = validateJDText(text);
    const preview = getPreview(text, 400);

    // Store in session
    req.session.jdText = text;
    req.session.candidateProfile = null; // Reset profile

    // Auto-analyze if resume is already uploaded
    let profileGenerated = false;
    if (req.session.resumeText) {
      try {
        req.session.candidateProfile = await analyzeCandidateProfile(req.session.resumeText, text);
        profileGenerated = true;
      } catch (analyzeErr) {
        console.error('[Profile Analysis Error]:', analyzeErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Job description uploaded and parsed successfully.',
      filename: req.file.originalname,
      fileSize: req.file.size,
      textLength: text.length,
      preview,
      isValidJD: isValid,
      profileGenerated,
      profile: profileGenerated ? {
        candidateName: req.session.candidateProfile?.candidateName,
        jobMatchPercent: req.session.candidateProfile?.jobMatchPercent,
        atsScore: req.session.candidateProfile?.atsScore,
      } : null,
    });
  } catch (err) {
    console.error('[Upload JD Error]:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/upload/paste-jd
 * Accept pasted job description text directly
 */
router.post('/paste-jd', express.json(), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Job description text is too short.' });
    }

    req.session.jdText = text.trim();
    req.session.candidateProfile = null;

    let profileGenerated = false;
    if (req.session.resumeText) {
      try {
        req.session.candidateProfile = await analyzeCandidateProfile(req.session.resumeText, text);
        profileGenerated = true;
      } catch (analyzeErr) {
        console.error('[Profile Analysis Error]:', analyzeErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Job description saved successfully.',
      textLength: text.length,
      preview: getPreview(text, 400),
      profileGenerated,
    });
  } catch (err) {
    console.error('[Paste JD Error]:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/upload/status
 * Check upload status for current session
 */
router.get('/status', (req, res) => {
  res.json({
    hasResume: !!req.session.resumeText,
    hasJD: !!req.session.jdText,
    hasProfile: !!req.session.candidateProfile,
    profile: req.session.candidateProfile ? {
      candidateName: req.session.candidateProfile.candidateName,
      experienceLevel: req.session.candidateProfile.experienceLevel,
      jobMatchPercent: req.session.candidateProfile.jobMatchPercent,
      atsScore: req.session.candidateProfile.atsScore,
      technicalSkills: req.session.candidateProfile.technicalSkills?.slice(0, 8),
      missingSkills: req.session.candidateProfile.missingSkills?.slice(0, 5),
    } : null,
  });
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
