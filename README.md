# OSCAR

> Note: This app is purely vibe-coded just for fun, not a serious product. It is not affiliated with any company or organization.

**O**n-the-spot **S**peech & **C**ommunication **A**nalysis **R**eviewer — a fully local, no-cloud
voice mock interview trainer. Pick a category and an interviewer persona, answer out loud (or by
typing), and get an AI-graded score with persona-toned feedback. Everything runs on your machine:
a local LLM via Ollama, local speech-to-text via faster-whisper, and a local SQLite history.

## Prerequisites

- **Python 3.10+**
- **Node.js 18+** / npm
- **[Ollama](https://ollama.com)** running locally with the grading model pulled:
  ```
  ollama pull qwen3.5:9b
  ```
- A microphone, for the voice recording flow (typed answers work without one).
- No `ffmpeg` required — audio is captured as WAV directly in the browser and decoded with
  `soundfile`, so there's nothing to install for speech-to-text beyond the Python packages below.

## Backend setup

```bash
cd backend
python -m venv venv
./venv/Scripts/activate       # Windows
# source venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API serves at `http://localhost:8000`. On first `/api/transcribe` call, `faster-whisper` will
download its `base` model automatically (one-time, from Hugging Face).

Config is environment-driven (see `backend/app/config.py`). By default it uses Ollama at
`http://localhost:11434` with model `qwen3.5:9b`. Override with `OLLAMA_URL`, `OSCAR_MODEL_NAME`,
`OSCAR_WHISPER_MODEL_SIZE` (`tiny`/`base`/`small`/`medium`), etc.

To use Groq instead of Ollama (faster, cloud-based, no local GPU needed):

```bash
# In backend/.env (copy from .env.example)
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
```

Available Groq models (set via `GROQ_FAST_MODEL` / `GROQ_GRADING_MODEL`):
- `llama-3.1-8b-instant` (fast, for question generation)
- `llama-3.3-70b-versatile` (stronger, for grading)
- `gemma2-9b-it`, `mixtral-8x7b-32768` (alternatives)

See `backend/.env.example` for all options.

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. It talks to the backend at `http://localhost:8000` (CORS is
pre-configured for the Vite dev origin).

## How grading works

Every answer is graded in two separate LLM calls so persona tone can never change the actual
score:

1. **Score call** — a fixed, neutral rubric prompt scores the answer 0–100 and extracts
   strengths/gaps/suggestions. Same prompt regardless of chosen persona.
2. **Delivery call** — the chosen persona (Strict, Friendly, Neutral, Rapid-fire) rewrites that
   structured result as prose feedback in its own voice. It narrates the score, it doesn't
   recalculate it. Rapid-fire additionally generates a pressure follow-up question when the score
   falls below its threshold.

## Note: local LLM latency

`qwen3.5:9b` is a reasoning ("thinking") model. On modest hardware (e.g. a laptop GPU with
6–8GB VRAM) each grading round can take a while, especially the first call after Ollama loads the
model into memory. The backend disables extended thinking mode (`"think": false`) for grading and
question-generation calls to keep this reasonable, and uses a generous 300s HTTP timeout to avoid
false failures on slower hardware. If grading feels too slow, try a smaller/faster model via
`OSCAR_MODEL_NAME`.

## Extending: web search fact-checking

The spec calls for validating technical claims against a local SearXNG instance before/during
grading. That's intentionally not wired up in this build (it needs a separate SearXNG + Valkey
service running). The extension point is `backend/app/grading.py::fact_check(claims)` — currently
a no-op stub. To add it:

1. Stand up SearXNG + Valkey locally (see SearXNG's own docs) with JSON output enabled.
2. Implement `fact_check` to query `http://localhost:8888/search?q=...&format=json` for claims
   worth verifying, and return notes.
3. Fold those notes into the score-call user prompt in `grade_answer()` before calling the LLM.

## Project layout

```
backend/app/
  main.py          FastAPI app + routes
  config.py        env-driven settings
  db.py            SQLite persistence (attempts table)
  schemas.py       pydantic request/response models
  questions.py     curated question bank + LLM question generation
  personas.py      persona registry (tone prompts, follow-up thresholds)
  llm_client.py    unified LLM wrapper (Ollama + Groq)
  ollama_client.py Ollama /api/chat wrapper (legacy, used by llm_client)
  grading.py       two-stage grading (score, then persona delivery)
  stt.py           faster-whisper transcription (soundfile decode, no ffmpeg)
  data/questions.json

frontend/src/
  api/client.ts              typed fetch wrappers
  hooks/useAudioRecorder.ts  Web Audio API mic capture -> 16kHz mono WAV, no MediaRecorder/ffmpeg
  hooks/wavEncoder.ts         downsampling + WAV encoding
  components/                CategoryPicker/PersonaPicker (SelectRail), QuestionCard, AnswerPanel,
                              FeedbackCard, HistoryPanel, Waveform
  App.tsx                     screen flow + state
```

## API reference

| Method | Path                     | Purpose                                  |
| ------ | ------------------------ | ----------------------------------------- |
| GET    | `/api/categories`        | List interview categories                 |
| GET    | `/api/personas`          | List interviewer personas                 |
| GET    | `/api/question?category=`| Random question from the curated bank     |
| POST   | `/api/question/generate` | LLM-generated question for a category     |
| POST   | `/api/transcribe`        | WAV upload -> transcribed text            |
| POST   | `/api/grade`             | Grade an answer, persists to history      |
| GET    | `/api/history`           | List past attempts                        |
| GET    | `/api/history/{id}`      | Full detail for one attempt               |
