/**
 * Report Routes
 * Handles final interview report generation and export
 */

const express = require('express');
const router = express.Router();
const { generateInterviewReport } = require('../services/gemini');

/**
 * POST /api/report/generate
 * Generate the final interview report
 */
router.post('/generate', async (req, res) => {
  try {
    if (!req.session.candidateProfile) {
      return res.status(400).json({ error: 'No interview profile found. Please upload resume and JD first.' });
    }

    if (!req.session.interviewHistory || req.session.interviewHistory.length < 2) {
      return res.status(400).json({ error: 'Interview has not been conducted yet. Please complete the interview first.' });
    }

    const report = await generateInterviewReport(
      req.session.candidateProfile,
      req.session.interviewHistory
    );

    // Store report in session
    req.session.finalReport = report;
    req.session.isInterviewActive = false;

    res.json({
      success: true,
      report,
      profile: {
        candidateName: req.session.candidateProfile.candidateName,
        currentRole: req.session.candidateProfile.currentRole,
        experienceLevel: req.session.candidateProfile.experienceLevel,
        totalExperience: req.session.candidateProfile.totalExperience,
        college: req.session.candidateProfile.college,
        educationLevel: req.session.candidateProfile.educationLevel,
      },
      interviewStats: {
        totalQuestions: req.session.questionCount,
        duration: req.session.startTime
          ? Math.floor((Date.now() - new Date(req.session.startTime).getTime()) / 1000)
          : 0,
        startTime: req.session.startTime,
      },
    });
  } catch (err) {
    console.error('[Report Generation Error]:', err);
    res.status(500).json({ error: 'Failed to generate report. Please try again.' });
  }
});

/**
 * GET /api/report/cached
 * Get the cached report if already generated
 */
router.get('/cached', (req, res) => {
  if (!req.session.finalReport) {
    return res.status(404).json({ error: 'No report found. Please generate a report first.' });
  }

  res.json({
    success: true,
    report: req.session.finalReport,
    profile: {
      candidateName: req.session.candidateProfile?.candidateName,
      experienceLevel: req.session.candidateProfile?.experienceLevel,
    },
  });
});

/**
 * GET /api/report/profile
 * Get detailed candidate profile
 */
router.get('/profile', (req, res) => {
  if (!req.session.candidateProfile) {
    return res.status(404).json({ error: 'No profile found.' });
  }

  res.json({
    success: true,
    profile: req.session.candidateProfile,
  });
});

module.exports = router;
