# 🎙 InterviewAI — AI Voice Interview Caller

Conduct fully automated AI screening interviews via your laptop's microphone and speaker. No Twilio, no telephony — just your browser, Vapi.ai, and a speakerphone.

---

## How It Works

1. You paste a Job Description into the dashboard.
2. You call the candidate from your phone and put it on **speakerphone** near your laptop.
3. You click **Start Interview** in the browser and allow microphone access.
4. The AI (Alex) takes over — introduces itself, asks JD-tailored questions, and conducts the full interview.
5. After the call ends, results appear automatically: transcript, scores (Overall, Technical, Communication), key highlights, and a hiring recommendation.

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Vapi.ai account** — [vapi.ai](https://vapi.ai) (free $10 trial credit ≈ 100+ minutes of calls)

---

## Setup (5 minutes)

### 1. Install dependencies
```bash
cd /path/to/ai-interview-caller
npm install
```

### 2. Configure your API keys
Copy the example env file and fill in your keys:
```bash
cp .env.example .env
```

Edit `.env`:
```
VAPI_PUBLIC_KEY=your_vapi_public_key_here
VAPI_PRIVATE_KEY=your_vapi_private_key_here
PORT=3000
```

### Where to get your Vapi keys
1. Sign up at [vapi.ai](https://vapi.ai)
2. Go to **Dashboard → Org Settings → API Keys**
3. Copy your **Public Key** and **Private Key**

### 3. Start the server
```bash
npm run dev    # Development (auto-restarts on changes)
# or
npm start      # Production
```

### 4. Open the app
```
http://localhost:3000
```

---

## Usage

| Step | Action |
|------|--------|
| 1 | Enter **Job Title** + paste the full **Job Description** → click **Save** |
| 2 | Type the **candidate's name** |
| 3 | Call the candidate → put your phone on **speakerphone** near the laptop |
| 4 | Click **Start Interview** → allow microphone permission in browser |
| 5 | The AI conducts the interview (~10 min). Monitor the live visualizer. |
| 6 | Click **End Interview** when done (or the AI will close it automatically) |
| 7 | Wait ~20 seconds for analysis → results appear automatically |

---

## Cost

| Component | Cost |
|-----------|------|
| Vapi platform | $0.05/min |
| Deepgram STT | $0.004/min |
| OpenAI GPT-4o-mini | ~$0.005/min |
| OpenAI TTS (Shimmer) | ~$0.015/min |
| **Total** | **~$0.08–$0.10/min** |
| 10-min interview | **~$0.80–$1.00** |
| Free trial credit | **$10 (~100 min free)** |

No Twilio. No phone numbers. No per-call fees.

---

## Project Structure

```
├── backend/
│   ├── index.js                 # Express server
│   ├── db/database.js           # SQLite setup
│   ├── services/promptBuilder.js # JD → interview prompt + Vapi config
│   └── routes/
│       ├── jobs.js              # Job CRUD API
│       └── candidates.js        # Candidate API + result polling
├── frontend/
│   ├── index.html               # Dashboard UI
│   ├── style.css                # Glassmorphic dark theme
│   └── app.js                   # Vapi Web SDK controller
├── data/
│   └── interviews.db            # SQLite database (auto-created)
├── .env.example                 # API key template
└── README.md
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "No API Key" warning | Make sure `.env` has both Vapi keys set correctly |
| Mic permission denied | Click the lock icon in the browser URL bar and allow microphone |
| Results show "processing" for >60s | The call may not have been long enough for Vapi to generate analysis. Try a longer call (>2 minutes). |
| AI can't hear candidate | Increase your phone's speaker volume and move it closer to the laptop mic |
| Port 3000 in use | Change `PORT=3001` in `.env` |

---

## Interview Questions Generated

The AI automatically generates relevant questions from your JD, always covering:
- Background & relevant experience
- 2 role-specific technical questions (from JD requirements)
- 1 behavioral question (STAR format)
- Salary expectations
- Availability / start date

---

## Tech Stack

- **Voice**: [Vapi.ai](https://vapi.ai) Web SDK (WebRTC)
- **STT**: Deepgram Nova-2
- **LLM**: OpenAI GPT-4o-mini
- **TTS**: OpenAI Shimmer voice
- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla HTML/CSS/JS
