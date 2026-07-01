/**
 * Interview Routes
 * Handles interview flow: start, questions, answers, feedback
 */

const express = require('express');
const router = express.Router();
const {
  generateOpeningMessage,
  generateNextQuestion,
  generateSuggestedAnswer,
  evaluateAnswer,
  analyzeCandidateProfile,
} = require('../services/gemini');

/**
 * Determine difficulty based on question count
 */
function getDifficulty(questionCount) {
  if (questionCount < 5) return 'easy';
  if (questionCount < 10) return 'medium';
  if (questionCount < 15) return 'advanced';
  return 'expert';
}

/**
 * POST /api/interview/start
 * Initialize interview and get opening message
 */
router.post('/start', async (req, res) => {
  try {
    if (!req.session.resumeText) {
      return res.status(400).json({ error: 'Please upload your resume first.' });
    }
    if (!req.session.jdText) {
      return res.status(400).json({ error: 'Please upload a job description first.' });
    }

    // Analyze profile if not already done
    if (!req.session.candidateProfile) {
      try {
        req.session.candidateProfile = await analyzeCandidateProfile(
          req.session.resumeText,
          req.session.jdText
        );
      } catch (err) {
        console.error('[Analyze Profile Error]:', err.message || err);
        return res.status(500).json({
          error: 'Failed to analyze documents: ' + (err.message || 'Unknown error. Check your API key and model access.'),
        });
      }
    }

    // Reset interview state
    req.session.interviewHistory = [];
    req.session.questionCount = 0;
    req.session.currentDifficulty = 'easy';
    req.session.askedQuestions = new Set();
    req.session.startTime = new Date().toISOString();
    req.session.isInterviewActive = true;

    // Generate opening message
    const openingMessage = await generateOpeningMessage(req.session.candidateProfile);

    // Store as first interviewer message
    req.session.interviewHistory.push({
      role: 'interviewer',
      content: openingMessage,
      timestamp: new Date().toISOString(),
      type: 'opening',
    });

    res.json({
      success: true,
      message: openingMessage,
      profile: {
        candidateName: req.session.candidateProfile.candidateName,
        experienceLevel: req.session.candidateProfile.experienceLevel,
        jobMatchPercent: req.session.candidateProfile.jobMatchPercent,
        atsScore: req.session.candidateProfile.atsScore,
        technicalSkills: req.session.candidateProfile.technicalSkills?.slice(0, 6),
        missingSkills: req.session.candidateProfile.missingSkills?.slice(0, 4),
        strengths: req.session.candidateProfile.strengths?.slice(0, 3),
        weaknesses: req.session.candidateProfile.weaknesses?.slice(0, 3),
      },
      sessionId: req.session.id,
    });
  } catch (err) {
    console.error('[Interview Start Error]:', err.message || err);
    res.status(500).json({
      error: err.message || 'Failed to start interview. Please try again.',
    });
  }
});

/**
 * POST /api/interview/answer
 * Process candidate answer and get next question
 */
router.post('/answer', async (req, res) => {
  try {
    const { answer } = req.body;

    if (!req.session.isInterviewActive) {
      return res.status(400).json({ error: 'No active interview. Please start an interview first.' });
    }

    if (!req.session.candidateProfile) {
      return res.status(400).json({ error: 'Interview session corrupted. Please restart.' });
    }

    if (!answer || answer.trim().length === 0) {
      return res.status(400).json({ error: 'Please provide an answer before continuing.' });
    }

    // Store candidate's answer
    req.session.interviewHistory.push({
      role: 'candidate',
      content: answer.trim(),
      timestamp: new Date().toISOString(),
      type: 'answer',
    });

    // Get the last question
    const lastQuestion = req.session.interviewHistory
      .filter(h => h.role === 'interviewer' && h.type !== 'opening')
      .slice(-1)[0];

    // Evaluate the answer
    let evaluation = null;
    if (lastQuestion) {
      try {
        evaluation = await evaluateAnswer(
          lastQuestion.content,
          answer.trim(),
          req.session.candidateProfile,
          req.session.interviewHistory
        );

        // Attach evaluation to the last candidate answer
        req.session.interviewHistory[req.session.interviewHistory.length - 1].evaluation = evaluation;
      } catch (evalErr) {
        console.error('[Evaluation Error]:', evalErr.message);
      }
    }

    // Update difficulty
    req.session.currentDifficulty = getDifficulty(req.session.questionCount);

    // Generate next question
    const nextQuestion = await generateNextQuestion(
      req.session.candidateProfile,
      req.session.interviewHistory,
      req.session.questionCount,
      req.session.currentDifficulty,
      Array.from(req.session.askedQuestions)
    );

    // Track asked topics (first 50 chars as key)
    req.session.askedQuestions.add(nextQuestion.substring(0, 50));
    req.session.questionCount++;
    req.session.currentDifficulty = getDifficulty(req.session.questionCount);

    // Store next question
    req.session.interviewHistory.push({
      role: 'interviewer',
      content: nextQuestion,
      timestamp: new Date().toISOString(),
      type: 'question',
      questionNumber: req.session.questionCount,
      difficulty: req.session.currentDifficulty,
    });

    res.json({
      success: true,
      nextQuestion,
      evaluation,
      questionNumber: req.session.questionCount,
      difficulty: req.session.currentDifficulty,
      totalQuestions: req.session.interviewHistory.filter(h => h.type === 'question').length,
    });
  } catch (err) {
    console.error('[Interview Answer Error]:', err);
    res.status(500).json({ error: 'Failed to process answer. Please try again.' });
  }
});

/**
 * POST /api/interview/hint
 * Get suggested answer for the current question
 */
router.post('/hint', async (req, res) => {
  try {
    if (!req.session.isInterviewActive) {
      return res.status(400).json({ error: 'No active interview.' });
    }

    // Get the last interviewer question
    const lastQuestion = req.session.interviewHistory
      .filter(h => h.role === 'interviewer')
      .slice(-1)[0];

    if (!lastQuestion) {
      return res.status(400).json({ error: 'No question found to generate hint for.' });
    }

    const hint = await generateSuggestedAnswer(
      lastQuestion.content,
      req.session.candidateProfile,
      req.session.interviewHistory
    );

    res.json({
      success: true,
      question: lastQuestion.content,
      hint,
    });
  } catch (err) {
    console.error('[Hint Error]:', err);
    res.status(500).json({ error: 'Failed to generate hint. Please try again.' });
  }
});

/**
 * GET /api/interview/status
 * Get current interview status
 */
router.get('/status', (req, res) => {
  res.json({
    isActive: req.session.isInterviewActive || false,
    questionCount: req.session.questionCount || 0,
    currentDifficulty: req.session.currentDifficulty || 'easy',
    duration: req.session.startTime
      ? Math.floor((Date.now() - new Date(req.session.startTime).getTime()) / 1000)
      : 0,
    hasProfile: !!req.session.candidateProfile,
    hasResume: !!req.session.resumeText,
    hasJD: !!req.session.jdText,
  });
});

/**
 * POST /api/interview/end
 * End the interview
 */
router.post('/end', (req, res) => {
  req.session.isInterviewActive = false;
  res.json({ success: true, message: 'Interview ended.', questionCount: req.session.questionCount });
});

/**
 * GET /api/interview/history
 * Get full interview history
 */
router.get('/history', (req, res) => {
  res.json({
    history: req.session.interviewHistory || [],
    questionCount: req.session.questionCount || 0,
    startTime: req.session.startTime,
  });
});

module.exports = router;
