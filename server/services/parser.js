/**
 * Document Parser Service
 * Handles PDF and DOCX parsing for resume and job description extraction
 */

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');

/**
 * Extract text from a PDF buffer
 */
async function extractFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    const text = data.text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!text || text.length < 50) {
      throw new Error('PDF appears to be empty or contains only images (scanned PDF).');
    }

    return text;
  } catch (err) {
    if (err.message.includes('empty')) throw err;
    throw new Error(`Failed to parse PDF: ${err.message}`);
  }
}

/**
 * Extract text from a DOCX buffer
 */
async function extractFromDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!text || text.length < 50) {
      throw new Error('DOCX appears to be empty or unreadable.');
    }

    // Log any warnings from mammoth
    if (result.messages && result.messages.length > 0) {
      console.warn('[DOCX Parser Warnings]:', result.messages);
    }

    return text;
  } catch (err) {
    if (err.message.includes('empty')) throw err;
    throw new Error(`Failed to parse DOCX: ${err.message}`);
  }
}

/**
 * Extract text from plain text buffer
 */
function extractFromTXT(buffer) {
  const text = buffer.toString('utf-8')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text || text.length < 10) {
    throw new Error('Text file appears to be empty.');
  }

  return text;
}

/**
 * Main extraction function - detects file type and extracts text
 */
async function extractText(buffer, mimetype, originalname) {
  const ext = path.extname(originalname).toLowerCase();

  // Determine parser based on mimetype and extension
  if (
    mimetype === 'application/pdf' ||
    ext === '.pdf'
  ) {
    return await extractFromPDF(buffer);
  }

  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimetype === 'application/msword' ||
    ext === '.docx' ||
    ext === '.doc'
  ) {
    return await extractFromDOCX(buffer);
  }

  if (
    mimetype === 'text/plain' ||
    ext === '.txt'
  ) {
    return extractFromTXT(buffer);
  }

  throw new Error(`Unsupported file format: ${ext || mimetype}. Please upload PDF, DOCX, or TXT.`);
}

/**
 * Validate that extracted text looks like a resume
 */
function validateResumeText(text) {
  const resumeIndicators = [
    /education|school|university|college|degree|bachelor|master|phd/i,
    /experience|work|job|position|role|company|employer/i,
    /skill|technology|programming|language|framework/i,
    /project|internship|certification|achievement/i,
    /email|phone|linkedin|github|contact/i,
  ];

  const matchCount = resumeIndicators.filter(pattern => pattern.test(text)).length;

  if (matchCount < 2) {
    console.warn('[Resume Validation] Text may not be a resume. Match count:', matchCount);
  }

  return matchCount >= 1; // At least one indicator
}

/**
 * Validate that extracted text looks like a job description
 */
function validateJDText(text) {
  const jdIndicators = [
    /requirement|qualification|skill|experience|responsibility/i,
    /role|position|job|career|opportunity/i,
    /apply|candidate|applicant|hiring|recruiter/i,
    /salary|compensation|benefit|package/i,
    /team|company|organization|department/i,
  ];

  const matchCount = jdIndicators.filter(pattern => pattern.test(text)).length;
  return matchCount >= 1;
}

/**
 * Get a preview snippet of the extracted text
 */
function getPreview(text, maxLength = 300) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

module.exports = {
  extractText,
  validateResumeText,
  validateJDText,
  getPreview,
};
