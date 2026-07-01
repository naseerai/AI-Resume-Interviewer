/**
 * Gemini AI Service — Production-Ready
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all interactions with the Google Generative AI API.
 * Features:
 *   • Robust JSON parsing with markdown-fence stripping & multi-strategy extraction
 *   • responseMimeType: 'application/json' for structured output
 *   • Automatic retry with exponential backoff (up to 3 attempts)
 *   • Full raw-response logging for debugging
 *   • Meaningful errors — no silent swallowing
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model reads from env — change GEMINI_MODEL in .env to switch
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ─── Retry config ──────────────────────────────────────────────────────────────
const MAX_RETRIES  = 3;
const RETRY_BASE_MS = 1500; // exponential: 1.5s → 3s → 6s

// ─── Logging helper ────────────────────────────────────────────────────────────
function log(tag, msg, extra) {
  const ts = new Date().toISOString();
  if (extra !== undefined) {
    console.log(`[${ts}] [GEMINI:${tag}] ${msg}`, typeof extra === 'string' ? extra.substring(0, 800) : JSON.stringify(extra).substring(0, 800));
  } else {
    console.log(`[${ts}] [GEMINI:${tag}] ${msg}`);
  }
}

function logError(tag, msg, err) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [GEMINI:${tag}] ❌ ${msg}`);
  if (err?.message) console.error(`  message : ${err.message}`);
  if (err?.stack)   console.error(`  stack   : ${err.stack.split('\n').slice(0,4).join('\n    ')}`);
}

// ─── Robust JSON Extraction Utility ────────────────────────────────────────────
/**
 * safeParseJSON
 * Attempts multiple strategies to extract a valid JSON object from an AI
 * response string that may contain markdown fences, extra prose, or whitespace.
 *
 * @param {string} raw     - The raw string returned by Gemini
 * @param {string} context - Human-readable label for logging (e.g. 'candidateProfile')
 * @returns {object}       - Parsed JavaScript object
 * @throws  {Error}        - If all strategies fail
 */
function safeParseJSON(raw, context = 'response') {
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`[${context}] AI returned an empty response.`);
  }

  log('PARSE', `Raw AI response for "${context}" (first 500 chars):`, raw.substring(0, 500));

  // Strategy 1: direct parse — model returned clean JSON
  try {
    return JSON.parse(raw.trim());
  } catch (_) { /* fall through */ }

  // Strategy 2: strip ```json ... ``` or ``` ... ``` markdown fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) { /* fall through */ }
  }

  // Strategy 3: extract the outermost {...} block
  const objStart = raw.indexOf('{');
  const objEnd   = raw.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    const candidate = raw.substring(objStart, objEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch (e1) {
      // Strategy 4: try to fix common issues (trailing commas, single quotes)
      try {
        const fixed = candidate
          .replace(/,\s*([}\]])/g, '$1')   // trailing commas
          .replace(/'/g, '"')               // single → double quotes
          .replace(/\n/g, ' ')             // collapse newlines
          .replace(/[\u0000-\u001F]/g, ''); // control chars
        return JSON.parse(fixed);
      } catch (_) { /* fall through */ }
    }
  }

  // Strategy 5: extract the outermost [...] array block
  const arrStart = raw.indexOf('[');
  const arrEnd   = raw.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(raw.substring(arrStart, arrEnd + 1));
    } catch (_) { /* fall through */ }
  }

  // All strategies failed — log the full raw response for debugging
  console.error(`[GEMINI:PARSE] ❌ ALL parse strategies failed for "${context}". Full raw response:`);
  console.error(raw);
  throw new Error(`Failed to parse ${context} from AI response. The model returned non-JSON output. Check server logs for the raw response.`);
}

// ─── Retry Wrapper ─────────────────────────────────────────────────────────────
/**
 * withRetry
 * Executes `fn` up to MAX_RETRIES times with exponential backoff.
 * Retries on network errors, 503 overload, or empty/invalid JSON errors.
 */
async function withRetry(fn, context = 'operation') {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log('RETRY', `Attempt ${attempt}/${MAX_RETRIES} for "${context}"`);
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      const isRetryable =
        msg.includes('503') ||
        msg.includes('overloaded') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('empty response') ||
        msg.includes('Failed to parse');

      if (!isRetryable || attempt === MAX_RETRIES) {
        logError('RETRY', `"${context}" failed permanently after ${attempt} attempt(s).`, err);
        throw err;
      }

      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      log('RETRY', `"${context}" attempt ${attempt} failed (${msg.substring(0, 80)}). Retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── Model Factory ─────────────────────────────────────────────────────────────
/**
 * getModel
 * Returns a Gemini model instance.
 * @param {boolean} jsonMode  - If true, sets responseMimeType to 'application/json'
 *                              for guaranteed structured output.
 * @param {string}  sysInstr  - Optional system instruction.
 */
function getModel(jsonMode = false, sysInstr = null) {
  const generationConfig = {
    temperature:     0.7,
    topK:            40,
    topP:            0.95,
    maxOutputTokens: 4096,
  };

  if (jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  const config = { model: MODEL_NAME, generationConfig };

  if (sysInstr) {
    config.systemInstruction = sysInstr;
  }

  return genAI.getGenerativeModel(config);
}

// ─── Call Gemini & Parse JSON ──────────────────────────────────────────────────
/**
 * callForJSON
 * Calls Gemini with `prompt` and extracts a JSON object from the response.
 * Uses responseMimeType JSON mode for guaranteed structured output, with
 * safeParseJSON as a robust fallback.
 */
async function callForJSON(prompt, context, jsonMode = true) {
  const model  = getModel(jsonMode);
  const result = await model.generateContent(prompt);

  // Check for empty or blocked response
  const candidate = result.response.candidates?.[0];
  if (!candidate) {
    log('CALL', `No candidates in response for "${context}". FinishReason: ${result.response.promptFeedback?.blockReason}`);
    throw new Error(`AI returned no candidates for "${context}". Possible content filtering.`);
  }

  const raw = result.response.text();

  if (!raw || raw.trim().length === 0) {
    throw new Error(`AI returned empty text for "${context}".`);
  }

  return safeParseJSON(raw, context);
}

// ─── Strict JSON Prompt Wrapper ────────────────────────────────────────────────
const JSON_SYSTEM_INSTRUCTION = `You are a JSON-only response API. 
You MUST return ONLY valid JSON. 
Do NOT include markdown code fences (\`\`\`json or \`\`\`). 
Do NOT include any explanation, commentary, or text before or after the JSON. 
Do NOT include trailing commas. 
Your entire response must be parseable by JSON.parse().`;

// ─── Public API Functions ──────────────────────────────────────────────────────

/**
 * analyzeCandidateProfile
 * Parses resume + JD and builds a rich candidate profile object.
 */
async function analyzeCandidateProfile(resumeText, jdText) {
  log('PROFILE', 'Starting candidate profile analysis…');

  const prompt = `Analyze the following resume and job description. Return a JSON object ONLY — no markdown, no explanation.

=== RESUME ===
${resumeText.substring(0, 8000)}

=== JOB DESCRIPTION ===
${jdText.substring(0, 4000)}

Return this EXACT JSON structure with real values extracted from the documents:
{
  "candidateName": "Full name from resume or 'Candidate' if not found",
  "currentRole": "Current or most recent job title",
  "totalExperience": "e.g. 2 years 3 months, or Fresher",
  "educationLevel": "Highest degree e.g. B.Tech, M.Tech, MBA",
  "cgpa": "CGPA or percentage if mentioned, else null",
  "college": "College or University name",
  "educationTimeline": [
    {"degree": "B.Tech", "institution": "XYZ University", "year": "2022", "score": "8.5 CGPA"}
  ],
  "summary": "2-3 sentence professional summary based on resume",
  "technicalSkills": ["JavaScript", "React", "Node.js"],
  "softSkills": ["Communication", "Teamwork"],
  "experienceLevel": "fresher",
  "projects": [
    {"name": "Project Name", "tech": ["React", "Node.js"], "description": "What it does", "impact": "Impact or outcome"}
  ],
  "internships": [
    {"company": "Company Name", "role": "Role", "duration": "3 months", "tech": ["Python"]}
  ],
  "certifications": ["AWS Certified", "Google Cloud"],
  "achievements": ["Won hackathon", "Dean's list"],
  "hackathons": ["Smart India Hackathon 2023"],
  "githubProjects": ["github.com/user/project"],
  "linkedinUrl": "https://linkedin.com/in/user or null",
  "strengths": ["Strong in full-stack", "Quick learner"],
  "weaknesses": ["Limited production experience", "No cloud exposure"],
  "missingSkills": ["Docker", "Kubernetes"],
  "jobMatchPercent": 75,
  "atsScore": 68,
  "atsKeywords": ["REST API", "agile", "microservices"],
  "jdRequiredSkills": ["Node.js", "React", "SQL"],
  "jdPreferredSkills": ["Docker", "AWS"],
  "jdResponsibilities": ["Build REST APIs", "Collaborate with team"],
  "jdExperienceRequired": "2+ years",
  "jdTechnologies": ["Node.js", "React", "PostgreSQL"],
  "jdSoftSkills": ["Communication", "Problem-solving"],
  "jdRoleExpectations": ["Ship features independently", "Write clean code"],
  "interviewFocus": ["React", "Node.js", "System Design", "Projects"],
  "suggestedQuestionTopics": ["OOP Concepts", "REST API design", "Past projects"],
  "difficultyLevel": "junior"
}

Rules:
- experienceLevel MUST be one of: fresher, junior, mid, senior, lead
- difficultyLevel MUST be one of: fresher, junior, mid, senior
- All array fields must be arrays, never null
- Numeric fields (jobMatchPercent, atsScore) must be integers 0-100
- Extract REAL data from the resume, do not invent data`;

  return withRetry(
    async () => {
      const model  = getModel(true, JSON_SYSTEM_INSTRUCTION);
      const result = await model.generateContent(prompt);

      const raw = result.response.text();
      log('PROFILE', 'Raw Gemini response received', raw);

      const parsed = safeParseJSON(raw, 'candidateProfile');

      // Sanitize required fields so downstream code never crashes
      parsed.candidateName     = parsed.candidateName     || 'Candidate';
      parsed.experienceLevel   = (['fresher','junior','mid','senior','lead'].includes(parsed.experienceLevel))
                                  ? parsed.experienceLevel : 'junior';
      parsed.technicalSkills   = Array.isArray(parsed.technicalSkills)   ? parsed.technicalSkills   : [];
      parsed.softSkills        = Array.isArray(parsed.softSkills)        ? parsed.softSkills        : [];
      parsed.projects          = Array.isArray(parsed.projects)          ? parsed.projects          : [];
      parsed.internships       = Array.isArray(parsed.internships)       ? parsed.internships       : [];
      parsed.certifications    = Array.isArray(parsed.certifications)    ? parsed.certifications    : [];
      parsed.achievements      = Array.isArray(parsed.achievements)      ? parsed.achievements      : [];
      parsed.strengths         = Array.isArray(parsed.strengths)         ? parsed.strengths         : [];
      parsed.weaknesses        = Array.isArray(parsed.weaknesses)        ? parsed.weaknesses        : [];
      parsed.missingSkills     = Array.isArray(parsed.missingSkills)     ? parsed.missingSkills     : [];
      parsed.jdRequiredSkills  = Array.isArray(parsed.jdRequiredSkills)  ? parsed.jdRequiredSkills  : [];
      parsed.jdTechnologies    = Array.isArray(parsed.jdTechnologies)    ? parsed.jdTechnologies    : [];
      parsed.interviewFocus    = Array.isArray(parsed.interviewFocus)    ? parsed.interviewFocus    : [];
      parsed.jobMatchPercent   = Number.isInteger(parsed.jobMatchPercent) ? parsed.jobMatchPercent  : 70;
      parsed.atsScore          = Number.isInteger(parsed.atsScore)        ? parsed.atsScore         : 70;

      log('PROFILE', `✅ Profile parsed — name: ${parsed.candidateName}, level: ${parsed.experienceLevel}, jdMatch: ${parsed.jobMatchPercent}%`);
      return parsed;
    },
    'analyzeCandidateProfile'
  );
}

/**
 * generateOpeningMessage
 * Returns a warm, natural opening from the "interviewer".
 */
async function generateOpeningMessage(profile) {
  log('OPENING', 'Generating opening message…');

  const firstName = (profile.candidateName || 'there').split(' ')[0];

  const prompt = `You are a Senior Technical and HR Interviewer at a top tech company. You are about to interview ${firstName}.

Candidate background:
- Experience Level: ${profile.experienceLevel}
- Recent Role: ${profile.currentRole || 'Software Developer'}
- Education: ${profile.educationLevel || 'Engineering'} from ${profile.college || 'University'}
- Key Skills: ${(profile.technicalSkills || []).slice(0, 5).join(', ')}

Write a warm, professional opening message:
- Use their FIRST NAME: ${firstName}
- Be natural and human — not robotic
- Briefly mention you reviewed their background
- Ask them to start with a brief introduction
- DO NOT mention AI or that you are an AI
- Maximum 3-4 sentences
- End with exactly one question asking them to introduce themselves

Return ONLY the message text. No JSON. No formatting.`;

  return withRetry(async () => {
    const model  = getModel(false);
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim();
    log('OPENING', '✅ Opening message generated', text);
    return text;
  }, 'generateOpeningMessage');
}

/**
 * generateNextQuestion
 * Generates the next contextual interview question.
 */
async function generateNextQuestion(profile, interviewHistory, questionCount, currentDifficulty, askedQuestionsArray) {
  log('QUESTION', `Generating question #${questionCount + 1}, difficulty: ${currentDifficulty}`);

  const historyText = interviewHistory
    .slice(-8)
    .map(h => `${h.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${h.content}`)
    .join('\n');

  const phase = questionCount < 5
    ? 'Focus on background, education, projects, and basic technical knowledge.'
    : questionCount < 10
    ? 'Dive into technical depth, problem-solving, system design, and work experience.'
    : questionCount < 15
    ? 'Cover advanced topics, leadership scenarios, and conflict resolution.'
    : 'Explore situational judgment, cultural fit, career goals, and future plans.';

  const prompt = `You are a Senior Technical and HR Interviewer conducting a real job interview.

CANDIDATE: ${profile.candidateName} — ${profile.experienceLevel} level (${profile.totalExperience || 'fresher'})
SKILLS: ${(profile.technicalSkills || []).join(', ')}
PROJECTS: ${(profile.projects || []).map(p => p.name).join(', ') || 'None listed'}
EDUCATION: ${profile.educationLevel || 'Engineering'} from ${profile.college || 'University'}, CGPA: ${profile.cgpa || 'Not stated'}
JD REQUIRED SKILLS: ${(profile.jdRequiredSkills || []).join(', ')}
INTERVIEW FOCUS: ${(profile.interviewFocus || []).join(', ')}

RECENT CONVERSATION:
${historyText || 'Interview just started.'}

QUESTION NUMBER: ${questionCount + 1}
DIFFICULTY: ${currentDifficulty}
ALREADY COVERED: ${(askedQuestionsArray || []).slice(-15).join(', ') || 'Nothing yet'}
PHASE GUIDANCE: ${phase}

Instructions:
1. Ask ONE natural, conversational question
2. Match difficulty: ${currentDifficulty}
3. Reference their resume details when relevant (projects, skills, college)
4. Mix types: technical, behavioral, situational, project-specific
5. Sound like a REAL human interviewer at Google/Amazon/Microsoft
6. Do NOT repeat already-covered topics
7. Do NOT say "Great question!" or similar filler
8. Do NOT reveal you are AI
9. Use STAR prompting for behavioral questions

Return ONLY the interview question. No labels, no formatting, no explanation.`;

  return withRetry(async () => {
    const model  = getModel(false);
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim();
    log('QUESTION', `✅ Question #${questionCount + 1}:`, text);
    return text;
  }, 'generateNextQuestion');
}

/**
 * generateSuggestedAnswer
 * Returns a structured hint object for the current question.
 */
async function generateSuggestedAnswer(question, profile, interviewHistory) {
  log('HINT', 'Generating suggested answer…');

  const context = interviewHistory.slice(-4)
    .map(h => `${h.role}: ${h.content}`)
    .join('\n');

  const prompt = `You are an expert interview coach. Generate structured interview preparation hints.

CANDIDATE:
- Name: ${profile.candidateName}
- Level: ${profile.experienceLevel} (${profile.totalExperience || 'fresher'})
- Skills: ${(profile.technicalSkills || []).slice(0, 10).join(', ')}
- Projects: ${(profile.projects || []).map(p => p.name + ' (' + (p.tech || []).join(', ') + ')').join('; ') || 'None'}

RECENT CONTEXT:
${context || 'Beginning of interview'}

QUESTION: "${question}"

Return ONLY this JSON object, no markdown, no extra text:
{
  "suggestedAnswer": "A natural 100-200 word answer in first person, specific to this candidate's experience",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3", "Key point 4"],
  "interviewerExpects": ["Expectation 1", "Expectation 2", "Expectation 3"],
  "mistakesToAvoid": ["Mistake 1", "Mistake 2", "Mistake 3"],
  "alternativeAnswer": "A shorter 50-80 word alternative approach",
  "bestKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "starVersion": "Situation: ... | Task: ... | Action: ... | Result: ... (or 'Not applicable')"
}`;

  return withRetry(async () => {
    const parsed = await callForJSON(prompt, 'suggestedAnswer', true);
    log('HINT', '✅ Hint generated');
    return parsed;
  }, 'generateSuggestedAnswer').catch(err => {
    logError('HINT', 'Hint generation failed — returning fallback', err);
    return {
      suggestedAnswer:   'Focus on your specific experience and be concrete with examples.',
      keyPoints:         ['Be specific', 'Use examples', 'Show measurable impact', 'Keep it concise'],
      interviewerExpects:['Relevant experience', 'Problem-solving ability', 'Clear communication'],
      mistakesToAvoid:   ['Being vague', 'Rambling', 'Not quantifying results'],
      alternativeAnswer: 'Keep it concise and focus on your strongest relevant point.',
      bestKeywords:      ['experience', 'impact', 'solution', 'result', 'team'],
      starVersion:       'Not applicable for this question type',
    };
  });
}

/**
 * evaluateAnswer
 * Evaluates a candidate's answer and returns structured feedback.
 */
async function evaluateAnswer(question, answer, profile, interviewHistory) {
  log('EVAL', 'Evaluating answer…');

  if (!answer || answer.trim().length < 5) {
    return {
      scores:          { communication: 30, technicalAccuracy: 30, confidence: 30, grammar: 30, professionalism: 30, relevance: 30, overall: 30 },
      positiveFeedback:['You attempted the question.'],
      improvements:    ['Please provide a detailed answer.'],
      betterWording:   'Try to elaborate with specific examples from your experience.',
      missingPoints:   ['Specific examples', 'Technical details', 'Quantified results'],
      rating:          'Needs Improvement',
      shortComment:    'Please provide more detail in your answers.',
    };
  }

  const prompt = `You are a Senior Interview Evaluator at a top tech company. Evaluate this answer professionally.

CANDIDATE: ${profile.candidateName} (${profile.experienceLevel}, ${profile.totalExperience || 'fresher'})
QUESTION: "${question}"
ANSWER: "${answer.substring(0, 2000)}"

Return ONLY this JSON object, no markdown, no extra text:
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
  "positiveFeedback": ["Positive point 1", "Positive point 2"],
  "improvements": ["Improvement 1", "Improvement 2"],
  "betterWording": "A polished 1-2 sentence version of their answer",
  "missingPoints": ["Missing point 1", "Missing point 2"],
  "rating": "Excellent",
  "shortComment": "One encouraging professional feedback sentence"
}

Rating must be exactly one of: Excellent, Good, Average, Needs Improvement
All scores must be integers 0-100. overall should be the mean of other scores.
If answer is very short (<15 words), score all fields below 40.`;

  return withRetry(async () => {
    const parsed = await callForJSON(prompt, 'evaluateAnswer', true);
    log('EVAL', `✅ Evaluation done — overall: ${parsed.scores?.overall}%, rating: ${parsed.rating}`);
    return parsed;
  }, 'evaluateAnswer').catch(err => {
    logError('EVAL', 'Evaluation failed — returning fallback', err);
    return {
      scores:          { communication: 70, technicalAccuracy: 70, confidence: 70, grammar: 70, professionalism: 70, relevance: 70, overall: 70 },
      positiveFeedback:['You attempted the question.'],
      improvements:    ['Provide more specific details.'],
      betterWording:   'Consider elaborating with concrete examples.',
      missingPoints:   ['Specific examples', 'Quantified results'],
      rating:          'Average',
      shortComment:    'Good attempt! Try to be more specific with examples next time.',
    };
  });
}

/**
 * generateInterviewReport
 * Generates the comprehensive final hiring report.
 */
async function generateInterviewReport(profile, interviewHistory) {
  log('REPORT', 'Generating final interview report…');

  const conversationSummary = interviewHistory
    .map(h => `${h.role === 'interviewer' ? 'Q' : 'A'}: ${h.content.substring(0, 300)}`)
    .join('\n')
    .substring(0, 5000);

  const avgScores = {};
  interviewHistory.filter(h => h.evaluation?.scores).forEach(h => {
    Object.entries(h.evaluation.scores).forEach(([k, v]) => {
      if (!avgScores[k]) avgScores[k] = [];
      avgScores[k].push(v);
    });
  });
  const scoreAverages = {};
  Object.entries(avgScores).forEach(([k, vals]) => {
    scoreAverages[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });

  const prompt = `You are a Senior HR Director generating a final interview evaluation report.

CANDIDATE: ${profile.candidateName}
ROLE: ${profile.currentRole || 'Software Developer'}
LEVEL: ${profile.experienceLevel} (${profile.totalExperience || 'fresher'})
JD MATCH: ${profile.jobMatchPercent || 70}%
ATS SCORE: ${profile.atsScore || 70}%
QUESTIONS ANSWERED: ${Math.floor(interviewHistory.length / 2)}

AVERAGE PERFORMANCE SCORES:
${JSON.stringify(scoreAverages, null, 2)}

INTERVIEW TRANSCRIPT SUMMARY:
${conversationSummary || 'No transcript available.'}

Return ONLY this JSON object, no markdown, no extra text:
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
  "verdictExplanation": "2-3 sentence explanation of the hiring decision based on interview performance",
  "strengths": ["Strength 1", "Strength 2", "Strength 3", "Strength 4"],
  "weaknesses": ["Weakness 1", "Weakness 2", "Weakness 3"],
  "missingSkills": ["Missing skill 1", "Missing skill 2", "Missing skill 3"],
  "topicsToStudy": [
    {"topic": "Topic Name", "priority": "High", "resources": "Where to study e.g. LeetCode, Udemy"}
  ],
  "mostAskedQuestions": ["Question category 1", "Question category 2", "Question category 3"],
  "recommendedCertifications": [
    {"name": "Certification Name", "platform": "Coursera", "relevance": "Why this helps"}
  ],
  "recommendedProjects": ["Project idea 1", "Project idea 2", "Project idea 3"],
  "interviewSummary": "3-4 professional sentences describing how the interview went",
  "finalVerdict": "2-3 sentence final recommendation for the candidate",
  "areasOfImprovement": ["Area 1", "Area 2", "Area 3"],
  "nextSteps": ["Actionable step 1", "Actionable step 2", "Actionable step 3"]
}

Rules:
- hiringRecommendation must be exactly one of: Strong Hire, Hire, Borderline, No Hire
- All score fields must be integers 0-100
- All array fields must be arrays
- topicsToStudy priority must be: High, Medium, or Low`;

  return withRetry(async () => {
    const parsed = await callForJSON(prompt, 'interviewReport', true);

    // Sanitize
    const validRecs = ['Strong Hire', 'Hire', 'Borderline', 'No Hire'];
    if (!validRecs.includes(parsed.hiringRecommendation)) {
      parsed.hiringRecommendation = 'Hire';
    }
    ['strengths','weaknesses','missingSkills','mostAskedQuestions','recommendedProjects',
     'areasOfImprovement','nextSteps'].forEach(k => {
      if (!Array.isArray(parsed[k])) parsed[k] = [];
    });
    if (!Array.isArray(parsed.topicsToStudy)) parsed.topicsToStudy = [];
    if (!Array.isArray(parsed.recommendedCertifications)) parsed.recommendedCertifications = [];

    log('REPORT', `✅ Report generated — recommendation: ${parsed.hiringRecommendation}, probability: ${parsed.hiringProbability}%`);
    return parsed;
  }, 'generateInterviewReport');
}

/**
 * streamResponse
 * Streams a raw text response chunk-by-chunk.
 */
async function streamResponse(prompt, onChunk) {
  const model  = getModel(false);
  const result = await model.generateContentStream(prompt);

  let fullText = '';
  for await (const chunk of result.stream) {
    const chunkText = chunk.text();
    fullText += chunkText;
    onChunk(chunkText);
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
};
