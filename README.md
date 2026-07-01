# 🤖 AI Resume Interviewer

> A production-quality AI-powered Interview Simulator that analyzes your Resume + Job Description and conducts intelligent personalized mock interviews using Google Gemini AI.

---

## ✨ Features

- 🎯 **Personalized Questions** — Based on your resume, JD, and conversation context
- 📄 **Document Analysis** — PDF & DOCX resume + JD parsing with ATS scoring
- 🤖 **AI Interviewer** — Behaves like a real senior interviewer (never mentions AI)
- 💡 **Answer Hints** — Suggested answers, STAR format, key points, keywords
- 📊 **Live Feedback** — Real-time evaluation after each answer
- 📈 **Adaptive Difficulty** — Easy → Medium → Advanced → Expert
- 🗣️ **Voice Mode** — Speech-to-Text input + Text-to-Speech AI questions
- 📑 **PDF Report** — Comprehensive hiring assessment with scores and recommendations
- 🌙 **Dark/Light Mode** — Premium ChatGPT-inspired UI
- ⌨️ **Keyboard Shortcuts** — Full keyboard navigation

---

## 🗂️ Project Structure

```
AI-AGENT-interview/
├── public/
│   ├── index.html          # Main HTML structure
│   ├── css/
│   │   └── style.css       # Complete stylesheet
│   └── js/
│       ├── utils.js        # Shared utilities & API client
│       ├── voice.js        # Speech-to-Text & Text-to-Speech
│       ├── upload.js       # File upload handling
│       ├── chat.js         # Chat UI rendering
│       ├── interview.js    # Interview flow controller
│       ├── report.js       # Report generation & PDF export
│       └── main.js         # App bootstrap & event wiring
├── server/
│   ├── routes/
│   │   ├── upload.js       # Upload endpoints
│   │   ├── interview.js    # Interview endpoints
│   │   └── report.js       # Report endpoints
│   └── services/
│       ├── gemini.js       # Gemini AI interactions
│       └── parser.js       # PDF/DOCX/TXT parsing
├── server.js               # Express server
├── package.json
├── .env                    # Environment variables (create from .env.example)
└── .env.example
```

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd AI-AGENT-interview
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your Gemini API key:
```
GEMINI_API_KEY=your_actual_key_here
PORT=3000
```

Get your key from: https://aistudio.google.com/app/apikey

### 3. Run the Application

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### 4. Open in Browser

```
http://localhost:3000
```

---

## 🎮 How to Use

1. **Upload Resume** — Click "Upload Resume" in sidebar (PDF or DOCX)
2. **Upload Job Description** — Click "Upload JD" (PDF, DOCX, or TXT)
3. **Wait for Analysis** — AI analyzes both documents and creates your profile
4. **Start Interview** — Click "Start Interview" or press `Ctrl+I`
5. **Answer Questions** — Type in the chat or use Voice mode
6. **Use Hints** — Click "Hint" or press `Ctrl+H` for answer guidance
7. **Get Feedback** — After each answer, see live evaluation
8. **Generate Report** — Click "View Report" or let the interview end naturally

---

## ⌨️ Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Send Answer | `Ctrl+Enter` |
| Get Hint | `Ctrl+H` |
| Voice Input | `Ctrl+M` |
| Skip Question | `Ctrl+K` |
| Toggle Sidebar | `Ctrl+B` |
| Start Interview | `Ctrl+I` |
| Toggle Theme | `Ctrl+T` |

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JS (ES6+) |
| Backend | Node.js, Express.js |
| AI Model | Google Gemini 1.5 Flash |
| PDF Parsing | pdf-parse |
| DOCX Parsing | mammoth |
| Markdown | marked.js (CDN) |
| PDF Export | html2pdf.js (CDN) |
| Voice | Web Speech API |

---

## 📊 Report Includes

- Overall / Technical / HR / Communication / Confidence scores
- Resume Match % & JD Match %
- Hiring Probability
- Hiring Recommendation (Strong Hire / Hire / Borderline / No Hire)
- Strengths & Weaknesses
- Missing Skills / Gaps
- Topics to Study (with priority)
- Recommended Certifications
- Recommended Projects to Build
- Interview Summary & Final Verdict
- Export as PDF

---

## 🛡️ Security Notes

- API Key stored in `.env` (never in client-side code)
- In-memory session storage (no database required)
- File size limits enforced (10MB max)
- Input validation on all endpoints
- `.env` is in `.gitignore` — never commit your API key

---

## 📝 License

MIT License — Free to use and modify.
