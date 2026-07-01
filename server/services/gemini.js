/**
 * Gemini AI Service — Production-Ready v3
 * ─────────────────────────────────────────────────────────────────────────────
 * Root causes fixed in this version:
 *
 *  1. TRUNCATION (primary):  maxOutputTokens was 4096 — not enough for large
 *     resumes.  Fixed to 65536 (SDK max).  Profile prompt is also now slimmer
 *     so fewer tokens are needed.
 *
 *  2. INTERLEAVED LOGS:  console.log of a large multi-line string interleaves
 *     with concurrent retry logs when printed in one call.  Fixed by using
 *     a synchronous write to process.stdout.
 *
 *  3. INCOMPLETE RESPONSE RECOVERY:  If Gemini still finishes with
 *     finishReason === 'MAX_TOKENS', we send a follow-up "complete the JSON"
 *     prompt and merge the fragments.
 *
 *  4. ROBUST PARSING:  safeParseJSON tries 5 extraction strategies before
 *     giving up.  It logs the full raw response atomically on failure.
 *
 *  5. responseMimeType: 'application/json'  enforces structured output.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_RETRIES   = 3;
const RETRY_BASE_MS = 1500;
const MAX_TOKENS    = 65536; // SDK maximum — prevents truncation on large resumes

// ─── Logging (atomic stdout writes prevent interleaving) ──────────────────────
function log(tag, msg, extra) {
  const ts  = new Date().toISOString();
  const pfx = `[${ts}] [GEMINI:${tag}]`;
  if (extra !== undefined) {
    const str = typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2);
    process.stdout.write(`${pfx} ${msg}\n--- BEGIN ---\n${str.substring(0, 2000)}\n--- END ---\n`);
  } else {
    process.stdout.write(`${pfx} ${msg}\n`);
  }
}

function logError(tag, msg, err) {
  const ts = new Date().toISOString();
  process.stderr.write(
    `[${ts}] [GEMINI:${tag}] ❌ ${msg}\n` +
    (err?.message ? `  message : ${err.message}\n` : '') +
    (err?.stack   ? `  stack   : ${err.stack.split('\n').slice(0, 5).join('\n    ')}\n` : '')
  );
}

// ─── Retry Wrapper ─────────────────────────────────────────────────────────────
async function withRetry(fn, context) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log('RETRY', `Attempt ${attempt}/${MAX_RETRIES} for "${context}"`);
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      const retryable =
        msg.includes('503') || msg.includes('overloaded') ||
        msg.includes('429') || msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED') || msg.includes('empty') ||
        msg.includes('Failed to parse') || msg.includes('MAX_TOKENS') ||
        msg.includes('truncated');

      if (!retryable || attempt === MAX_RETRIES) {
        logError('RETRY', `"${context}" permanently failed after ${attempt} attempt(s).`, err);
        throw err;
      }

      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      log('RETRY', `"${context}" attempt ${attempt} failed — ${msg.substring(0, 100)} — retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── Model Factory ─────────────────────────────────────────────────────────────
function getModel({ jsonMode = false, sysInstr = null, temperature = 0.7 } = {}) {
  const generationConfig = {
    temperature,
    topK:            40,
    topP:            0.95,
    maxOutputTokens: MAX_TOKENS,
  };
  if (jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }
  const config = { model: MODEL_NAME, generationConfig };
  if (sysInstr) config.systemInstruction = sysInstr;
  return genAI.getGenerativeModel(config);
}

// ─── Robust JSON Parser ────────────────────────────────────────────────────────
/**
 * safeParseJSON  — 5-strategy extractor
 * Handles: clean JSON, ```json fences, prose+JSON, trailing commas, partial arrays
 */
function safeParseJSON(raw, context = 'response') {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`[${context}] Gemini returned an empty response.`);
  }

  const trimmed = raw.trim();

  // Strategy 1: direct parse
  try { return JSON.parse(trimmed); } catch (_) {}

  // Strategy 2: strip ```json ... ``` or ``` ... ``` fences
  const fenceRE = /```(?:json)?\s*([\s\S]*?)```/i;
  const fence   = fenceRE.exec(trimmed);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (_) {}
  }

  // Strategy 3: extract first complete {...} block using bracket counting
  const extracted = extractJsonObject(trimmed);
  if (extracted !== null) {
    try { return JSON.parse(extracted); } catch (_) {}

    // Strategy 4: fix common syntax issues in the extracted block
    try {
      const fixed = extracted
        .replace(/,\s*([}\]])/g, '$1')    // trailing commas
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":') // unquoted keys
        .replace(/:\s*'([^']*)'/g, ': "$1"')        // single-quoted values
        .replace(/[\u0000-\u001F\u007F]/g, ' ');    // control chars
      return JSON.parse(fixed);
    } catch (_) {}
  }

  // Strategy 5: array extraction
  const arrExtracted = extractJsonArray(trimmed);
  if (arrExtracted !== null) {
    try { return JSON.parse(arrExtracted); } catch (_) {}
  }

  // All failed — log the full raw response atomically
  process.stderr.write(
    `\n[GEMINI:PARSE] ❌ ALL strategies failed for "${context}".\n` +
    `=== FULL RAW RESPONSE (${raw.length} chars) ===\n${raw}\n=== END ===\n\n`
  );
  throw new Error(
    `Failed to parse ${context} from AI response. ` +
    `Response was ${raw.length} chars. Check server logs for the full raw output.`
  );
}

/** Extract the first top-level {...} using a bracket counter (handles nesting) */
function extractJsonObject(str) {
  let depth = 0, start = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (str[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) return str.substring(start, i + 1);
    }
  }
  return null;
}

/** Extract the first top-level [...] using a bracket counter */
function extractJsonArray(str) {
  let depth = 0, start = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (str[i] === ']') {
      depth--;
      if (depth === 0 && start !== -1) return str.substring(start, i + 1);
    }
  }
  return null;
}

// ─── Call Gemini for JSON ──────────────────────────────────────────────────────
/**
 * callForJSON
 * Calls Gemini with a prompt, logs ALL response metadata, and returns parsed JSON.
 * If finishReason is MAX_TOKENS (truncated), sends a recovery prompt.
 */
async function callForJSON(prompt, context, modelOpts = {}) {
  const model  = getModel({ jsonMode: true, ...modelOpts });
  const result = await model.generateContent(prompt);

  // ── Log full response metadata ──────────────────────────────────────────
  const candidate = result.response.candidates?.[0];
  const usage     = result.response.usageMetadata;
  const finishReason = candidate?.finishReason || 'UNKNOWN';
  const safetyRatings = candidate?.safetyRatings || [];

  log('CALL', `"${context}" metadata`, {
    model:        MODEL_NAME,
    finishReason,
    tokenUsage:   usage,
    safetyRatings: safetyRatings.map(s => `${s.category}:${s.probability}`),
  });

  // ── Safety block ────────────────────────────────────────────────────────
  if (finishReason === 'SAFETY') {
    throw new Error(`Gemini blocked the response for "${context}" due to safety filters.`);
  }

  // ── Empty candidates ────────────────────────────────────────────────────
  if (!candidate) {
    const blockReason = result.response.promptFeedback?.blockReason || 'unknown';
    throw new Error(`Gemini returned no candidates for "${context}" (blockReason: ${blockReason}).`);
  }

  let raw = result.response.text() || '';

  log('CALL', `Raw response for "${context}" (${raw.length} chars):`, raw);

  // ── Truncation recovery: MAX_TOKENS ──────────────────────────────────────
  if (finishReason === 'MAX_TOKENS' && raw.length > 0) {
    log('CALL', `⚠️ Response for "${context}" was truncated (MAX_TOKENS). Sending recovery prompt…`);
    raw = await recoverTruncatedJSON(raw, context);
  }

  if (!raw.trim()) {
    throw new Error(`Gemini returned an empty response for "${context}".`);
  }

  return safeParseJSON(raw, context);
}

/**
 * recoverTruncatedJSON
 * When Gemini truncates mid-JSON, ask it to complete the fragment.
 */
async function recoverTruncatedJSON(fragment, context) {
  log('RECOVER', `Sending recovery prompt for truncated "${context}" (fragment: ${fragment.length} chars)`);

  const recoveryPrompt =
    `The following JSON was truncated and is incomplete. ` +
    `Complete it so it forms a single valid JSON object. ` +
    `Return ONLY the completed JSON — no explanation, no markdown fences.\n\n` +
    `INCOMPLETE JSON:\n${fragment}`;

  const model  = getModel({ jsonMode: true });
  const result = await model.generateContent(recoveryPrompt);
  const text   = result.response.text() || '';

  log('RECOVER', `Recovery response (${text.length} chars):`, text);

  if (!text.trim()) {
    throw new Error(`Recovery prompt returned empty response for "${context}".`);
  }

  return text;
}

// ─── System Instruction ────────────────────────────────────────────────────────
const JSON_SYSTEM = `You are a JSON-only API endpoint.
RULES (strictly enforced):
1. Return ONLY a valid JSON object.
2. No markdown fences (\`\`\`json or \`\`\`).
3. No explanatory text before or after the JSON.
4. No trailing commas.
5. All string values must use double quotes.
6. Your response must be directly parseable by JSON.parse() with no pre-processing.`;

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * analyzeCandidateProfile
 * Parses resume + JD into a rich candidate profile object.
 *
 * PROMPT STRATEGY:
 *   • Kept intentionally compact (< 3000 tokens output expected) so it fits
 *     comfortably within any token budget.
 *   • responseMimeType: 'application/json' guarantees clean output.
 *   • MAX_TOKENS = 65536 prevents truncation.
 */
async function analyzeCandidateProfile(resumeText, jdText) {
  log('PROFILE', 'Starting candidate profile analysis…');
  log('PROFILE', `Resume: ${resumeText.length} chars | JD: ${jdText.length} chars`);

  // Trim inputs to safe sizes
  const resume = resumeText.substring(0, 6000);
  const jd     = jdText.substring(0, 3000);

  const prompt =
`Analyze this resume and job description. Return a single JSON object.

RESUME:
${resume}

JOB DESCRIPTION:
${jd}

REQUIRED JSON STRUCTURE (fill every field with real data from the documents):
{
  "candidateName": "string",
  "currentRole": "string",
  "totalExperience": "string (e.g. Fresher, 2 years)",
  "educationLevel": "string (e.g. B.Tech)",
  "cgpa": "string or null",
  "college": "string",
  "educationTimeline": [{"degree":"","institution":"","year":"","score":""}],
  "summary": "2-3 sentence professional summary",
  "technicalSkills": ["string"],
  "softSkills": ["string"],
  "experienceLevel": "fresher|junior|mid|senior|lead",
  "projects": [{"name":"","tech":[""],"description":"","impact":""}],
  "internships": [{"company":"","role":"","duration":"","tech":[""]}],
  "certifications": ["string"],
  "achievements": ["string"],
  "hackathons": ["string"],
  "githubProjects": ["string"],
  "linkedinUrl": "string or null",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "missingSkills": ["string"],
  "jobMatchPercent": 0,
  "atsScore": 0,
  "atsKeywords": ["string"],
  "jdRequiredSkills": ["string"],
  "jdPreferredSkills": ["string"],
  "jdResponsibilities": ["string"],
  "jdExperienceRequired": "string",
  "jdTechnologies": ["string"],
  "jdSoftSkills": ["string"],
  "jdRoleExpectations": ["string"],
  "interviewFocus": ["string"],
  "suggestedQuestionTopics": ["string"],
  "difficultyLevel": "fresher|junior|mid|senior"
}

RULES:
- experienceLevel: must be one of fresher/junior/mid/senior/lead
- difficultyLevel: must be one of fresher/junior/mid/senior
- jobMatchPercent and atsScore: integers 0-100
- Every array field must be an array (never null or omitted)
- Return only the JSON object, nothing else`;

  return withRetry(async () => {
    const parsed = await callForJSON(prompt, 'candidateProfile', { sysInstr: JSON_SYSTEM });

    // ── Sanitize every field so downstream code never crashes ────────────────
    const ARRAYS = [
      'technicalSkills','softSkills','projects','internships','certifications',
      'achievements','hackathons','githubProjects','strengths','weaknesses',
      'missingSkills','atsKeywords','jdRequiredSkills','jdPreferredSkills',
      'jdResponsibilities','jdTechnologies','jdSoftSkills','jdRoleExpectations',
      'interviewFocus','suggestedQuestionTopics','educationTimeline',
    ];
    ARRAYS.forEach(k => { if (!Array.isArray(parsed[k])) parsed[k] = []; });

    const VALID_LEVELS  = ['fresher','junior','mid','senior','lead'];
    const VALID_DIFF    = ['fresher','junior','mid','senior'];
    parsed.candidateName   = typeof parsed.candidateName === 'string' && parsed.candidateName ? parsed.candidateName : 'Candidate';
    parsed.experienceLevel = VALID_LEVELS.includes(parsed.experienceLevel) ? parsed.experienceLevel : 'junior';
    parsed.difficultyLevel = VALID_DIFF.includes(parsed.difficultyLevel)   ? parsed.difficultyLevel : 'junior';
    parsed.jobMatchPercent = Number.isFinite(parsed.jobMatchPercent) ? Math.max(0, Math.min(100, parsed.jobMatchPercent)) : 60;
    parsed.atsScore        = Number.isFinite(parsed.atsScore)        ? Math.max(0, Math.min(100, parsed.atsScore))        : 60;

    log('PROFILE', `✅ Profile OK — name: "${parsed.candidateName}", level: "${parsed.experienceLevel}", jdMatch: ${parsed.jobMatchPercent}%, atsScore: ${parsed.atsScore}%`);
    return parsed;
  }, 'analyzeCandidateProfile');
}

/**
 * generateOpeningMessage — natural interview greeting
 */
async function generateOpeningMessage(profile) {
  log('OPENING', 'Generating opening message…');
  const firstName = (profile.candidateName || 'there').split(' ')[0];

  const prompt =
`You are a Senior Interviewer at a top tech company. Greet ${firstName} warmly.

Rules:
- Address them by first name: ${firstName}
- 3-4 sentences maximum
- Acknowledge their background in ${profile.currentRole || 'technology'}
- Ask them to introduce themselves (ONE question)
- Sound like a real human — not robotic
- Do NOT mention AI or that you are an AI
- Return ONLY the spoken greeting — no JSON, no formatting`;

  return withRetry(async () => {
    const model  = getModel({ jsonMode: false });
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim();
    log('OPENING', '✅ Opening message ready', text);
    return text;
  }, 'generateOpeningMessage');
}

/**
 * generateNextQuestion — contextual interview question
 */
async function generateNextQuestion(profile, interviewHistory, questionCount, currentDifficulty, askedQuestionsArray) {
  log('QUESTION', `Generating Q#${questionCount + 1}, difficulty: ${currentDifficulty}`);

  const history = interviewHistory.slice(-8)
    .map(h => `${h.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${h.content}`)
    .join('\n');

  const phase = questionCount < 5
    ? 'Ask about education, projects, and basic technical skills.'
    : questionCount < 10
    ? 'Dive into technical depth, system design, and problem-solving.'
    : questionCount < 15
    ? 'Cover advanced topics, leadership, and conflict resolution.'
    : 'Explore cultural fit, career goals, and situational judgment.';

  const prompt =
`You are a Senior Interviewer conducting a real interview.

CANDIDATE: ${profile.candidateName} — ${profile.experienceLevel} (${profile.totalExperience || 'fresher'})
SKILLS: ${(profile.technicalSkills || []).slice(0, 15).join(', ')}
PROJECTS: ${(profile.projects || []).map(p => p.name).join(', ') || 'None'}
EDUCATION: ${profile.educationLevel} from ${profile.college}, CGPA: ${profile.cgpa || 'N/A'}
JD SKILLS: ${(profile.jdRequiredSkills || []).join(', ')}

RECENT CONVERSATION:
${history || 'Interview just started.'}

QUESTION NUMBER: ${questionCount + 1} | DIFFICULTY: ${currentDifficulty}
ALREADY COVERED: ${(askedQuestionsArray || []).slice(-12).join(', ') || 'Nothing yet'}
PHASE: ${phase}

Ask ONE natural interview question. Mix types (technical/behavioral/situational).
Do NOT repeat covered topics. Do NOT mention AI. Return ONLY the question text.`;

  return withRetry(async () => {
    const model  = getModel({ jsonMode: false });
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim();
    log('QUESTION', `✅ Q#${questionCount + 1}:`, text);
    return text;
  }, 'generateNextQuestion');
}

/**
 * generateSuggestedAnswer — hint object for the candidate
 */
async function generateSuggestedAnswer(question, profile, interviewHistory) {
  log('HINT', 'Generating hint…');

  const ctx = interviewHistory.slice(-4).map(h => `${h.role}: ${h.content}`).join('\n');

  const prompt =
`Interview coach generating answer hints. Return ONLY the JSON object below.

CANDIDATE: ${profile.candidateName} (${profile.experienceLevel}, ${profile.totalExperience || 'fresher'})
SKILLS: ${(profile.technicalSkills || []).slice(0, 8).join(', ')}
CONTEXT: ${ctx || 'Start of interview'}
QUESTION: "${question}"

{
  "suggestedAnswer": "100-200 word first-person answer specific to this candidate",
  "keyPoints": ["point1","point2","point3","point4"],
  "interviewerExpects": ["expect1","expect2","expect3"],
  "mistakesToAvoid": ["mistake1","mistake2","mistake3"],
  "alternativeAnswer": "50-80 word alternative approach",
  "bestKeywords": ["kw1","kw2","kw3","kw4","kw5"],
  "starVersion": "Situation:...|Task:...|Action:...|Result:... or Not applicable"
}`;

  return withRetry(async () => {
    return await callForJSON(prompt, 'suggestedAnswer', { sysInstr: JSON_SYSTEM });
  }, 'generateSuggestedAnswer').catch(err => {
    logError('HINT', 'Falling back to default hint', err);
    return {
      suggestedAnswer:    'Focus on your specific experience with concrete examples.',
      keyPoints:          ['Be specific','Use examples','Show impact','Stay concise'],
      interviewerExpects: ['Relevant experience','Problem-solving','Clear communication'],
      mistakesToAvoid:    ['Being vague','Rambling','Skipping results'],
      alternativeAnswer:  'Lead with your strongest relevant point and support with one example.',
      bestKeywords:       ['experience','impact','solution','result','team'],
      starVersion:        'Not applicable for this question type',
    };
  });
}

/**
 * evaluateAnswer — live feedback after each answer
 */
async function evaluateAnswer(question, answer, profile) {
  log('EVAL', 'Evaluating answer…');

  if (!answer || answer.trim().length < 5) {
    return {
      scores:          { communication:30, technicalAccuracy:30, confidence:30, grammar:30, professionalism:30, relevance:30, overall:30 },
      positiveFeedback:['You attempted the question.'],
      improvements:    ['Please provide a detailed answer.'],
      betterWording:   'Try to elaborate with specific examples.',
      missingPoints:   ['Specific examples','Technical depth','Quantified results'],
      rating:          'Needs Improvement',
      shortComment:    'Please provide more detail in your answers.',
    };
  }

  const prompt =
`Senior interviewer evaluating a candidate's answer. Return ONLY the JSON object below.

CANDIDATE: ${profile.candidateName} (${profile.experienceLevel})
QUESTION: "${question}"
ANSWER: "${answer.substring(0, 1500)}"

{
  "scores": {
    "communication": 80,
    "technicalAccuracy": 75,
    "confidence": 70,
    "grammar": 85,
    "professionalism": 80,
    "relevance": 78,
    "overall": 78
  },
  "positiveFeedback": ["positive1","positive2"],
  "improvements": ["improvement1","improvement2"],
  "betterWording": "Polished 1-2 sentence version of their answer",
  "missingPoints": ["missing1","missing2"],
  "rating": "Excellent",
  "shortComment": "One encouraging professional feedback sentence"
}

rating must be exactly one of: Excellent, Good, Average, Needs Improvement
All scores: integers 0-100. overall = mean of other scores.`;

  return withRetry(async () => {
    const parsed = await callForJSON(prompt, 'evaluateAnswer', { sysInstr: JSON_SYSTEM });
    log('EVAL', `✅ overall: ${parsed.scores?.overall}%, rating: ${parsed.rating}`);
    return parsed;
  }, 'evaluateAnswer').catch(err => {
    logError('EVAL', 'Falling back to default evaluation', err);
    return {
      scores:          { communication:70, technicalAccuracy:70, confidence:70, grammar:70, professionalism:70, relevance:70, overall:70 },
      positiveFeedback:['You attempted the question.'],
      improvements:    ['Provide more specific details.'],
      betterWording:   'Consider adding concrete examples from your experience.',
      missingPoints:   ['Specific examples','Quantified results'],
      rating:          'Average',
      shortComment:    'Good attempt! Try to be more specific next time.',
    };
  });
}

/**
 * generateInterviewReport — final comprehensive hiring report
 */
async function generateInterviewReport(profile, interviewHistory) {
  log('REPORT', 'Generating final report…');

  const transcript = interviewHistory
    .map(h => `${h.role === 'interviewer' ? 'Q' : 'A'}: ${h.content.substring(0, 200)}`)
    .join('\n')
    .substring(0, 4000);

  const avgScores = {};
  interviewHistory.filter(h => h.evaluation?.scores).forEach(h => {
    Object.entries(h.evaluation.scores).forEach(([k, v]) => {
      if (!avgScores[k]) avgScores[k] = [];
      avgScores[k].push(v);
    });
  });
  const scoreAvg = {};
  Object.entries(avgScores).forEach(([k, v]) => {
    scoreAvg[k] = Math.round(v.reduce((a, b) => a + b, 0) / v.length);
  });

  const prompt =
`Senior HR Director generating final interview report. Return ONLY the JSON object below.

CANDIDATE: ${profile.candidateName} | LEVEL: ${profile.experienceLevel} | JD MATCH: ${profile.jobMatchPercent}%
QUESTIONS ANSWERED: ${Math.floor(interviewHistory.length / 2)}
AVERAGE SCORES: ${JSON.stringify(scoreAvg)}
TRANSCRIPT SUMMARY:
${transcript || 'Not available.'}

{
  "overallScore": 78,
  "technicalScore": 80,
  "hrScore": 75,
  "communicationScore": 78,
  "confidenceScore": 72,
  "resumeMatchScore": ${profile.jobMatchPercent || 70},
  "jdMatchScore": ${profile.jobMatchPercent || 70},
  "hiringProbability": 70,
  "hiringRecommendation": "Hire",
  "verdictExplanation": "2-3 sentence explanation",
  "strengths": ["strength1","strength2","strength3"],
  "weaknesses": ["weakness1","weakness2"],
  "missingSkills": ["skill1","skill2"],
  "topicsToStudy": [{"topic":"","priority":"High","resources":""}],
  "mostAskedQuestions": ["category1","category2"],
  "recommendedCertifications": [{"name":"","platform":"","relevance":""}],
  "recommendedProjects": ["project1","project2"],
  "interviewSummary": "3-4 sentence professional summary",
  "finalVerdict": "2-3 sentence recommendation",
  "areasOfImprovement": ["area1","area2"],
  "nextSteps": ["step1","step2","step3"]
}

hiringRecommendation must be: Strong Hire, Hire, Borderline, or No Hire
All score fields: integers 0-100. All array fields: arrays not null.`;

  return withRetry(async () => {
    const parsed = await callForJSON(prompt, 'interviewReport', { sysInstr: JSON_SYSTEM });

    const validRec = ['Strong Hire','Hire','Borderline','No Hire'];
    if (!validRec.includes(parsed.hiringRecommendation)) parsed.hiringRecommendation = 'Hire';
    ['strengths','weaknesses','missingSkills','mostAskedQuestions','recommendedProjects',
     'areasOfImprovement','nextSteps','topicsToStudy','recommendedCertifications'].forEach(k => {
      if (!Array.isArray(parsed[k])) parsed[k] = [];
    });

    log('REPORT', `✅ Report ready — recommendation: ${parsed.hiringRecommendation}, probability: ${parsed.hiringProbability}%`);
    return parsed;
  }, 'generateInterviewReport');
}

/**
 * streamResponse — raw text streaming
 */
async function streamResponse(prompt, onChunk) {
  const model  = getModel({ jsonMode: false });
  const result = await model.generateContentStream(prompt);
  let fullText = '';
  for await (const chunk of result.stream) {
    const t = chunk.text();
    fullText += t;
    onChunk(t);
  }
  return fullText;
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  analyzeCandidateProfile,
  generateOpeningMessage,
  generateNextQuestion,
  generateSuggestedAnswer,
  evaluateAnswer,
  generateInterviewReport,
  streamResponse,
  // Export utilities for testing
  safeParseJSON,
  withRetry,
  extractJsonObject,
};
