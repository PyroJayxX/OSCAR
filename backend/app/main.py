import io
import json
from contextlib import asynccontextmanager
from pydantic import BaseModel

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app import db, grading, personas, questions, stt, tts
from app.config import CORS_ORIGINS, GROQ_API_KEY, LLM_PROVIDER, TTS_ENGINE, KOKORO_VOICE_MAP
from app.schemas import (
    AttemptDetail,
    AttemptSummary,
    CategoryOut,
    GenerateQuestionIn,
    GradeIn,
    PersonaOut,
    QuestionOut,
    TranscribeOut,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    # Validate Groq configuration at startup
    if LLM_PROVIDER == "groq" and not GROQ_API_KEY:
        raise RuntimeError("LLM_PROVIDER=groq but GROQ_API_KEY is not set. Set GROQ_API_KEY in environment or .env file.")
    yield


app = FastAPI(title="OSCAR API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/categories", response_model=list[CategoryOut])
def get_categories():
    return questions.list_categories()


@app.get("/api/personas", response_model=list[PersonaOut])
def get_personas():
    return personas.list_personas()


@app.get("/api/question", response_model=QuestionOut)
def get_question(category: str, session_id: str = "default"):
    if not questions.is_valid_category(category):
        raise HTTPException(status_code=404, detail="Unknown category")
    q = questions.get_question_details(category, session_id)
    if q is None:
        raise HTTPException(status_code=404, detail="No more questions in this category for this session")
    return {
        "category": category,
        "question": q["text"],
        "difficulty": q.get("difficulty"),
        "type": q.get("type"),
        "key_points": q.get("key_points", []),
        "common_mistakes": q.get("common_mistakes", []),
    }


@app.post("/api/question/generate", response_model=QuestionOut)
async def post_generate_question(body: GenerateQuestionIn):
    if not questions.is_valid_category(body.category):
        raise HTTPException(status_code=404, detail="Unknown category")
    question = await questions.generate_question(body.category)
    return {"category": body.category, "question": question, "difficulty": None, "type": None, "key_points": [], "common_mistakes": []}


@app.post("/api/transcribe", response_model=TranscribeOut)
async def post_transcribe(file: UploadFile):
    wav_bytes = await file.read()
    text = stt.transcribe(wav_bytes)
    return {"text": text}


class TTSIn(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = None
    persona: str | None = None


@app.post("/api/tts")
async def post_tts(body: TTSIn):
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="Text is empty")

    if TTS_ENGINE == "kokoro":
        from app.tts_kokoro import synthesize_wav as kokoro_synthesize
        # Use persona-specific voice if provided, otherwise use voice parameter or default
        if body.persona and body.persona in KOKORO_VOICE_MAP:
            voice = KOKORO_VOICE_MAP[body.persona]
        else:
            voice = body.voice or "af_heart"
        wav_bytes = kokoro_synthesize(
            body.text.strip(),
            voice=voice,
            speed=body.speed or 1.0,
        )
    else:
        from app.tts import synthesize_wav as piper_synthesize
        wav_bytes = piper_synthesize(body.text.strip())

    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")


def _ndjson(obj: dict) -> bytes:
    return (json.dumps(obj) + "\n").encode("utf-8")


@app.post("/api/grade")
async def post_grade(body: GradeIn):
    if not questions.is_valid_category(body.category):
        raise HTTPException(status_code=404, detail="Unknown category")
    if not personas.is_valid_persona(body.persona):
        raise HTTPException(status_code=404, detail="Unknown persona")
    if not body.answer_text.strip():
        raise HTTPException(status_code=400, detail="Answer text is empty")

    # Use key_points and common_mistakes from request body
    # (frontend sends them with the question, so no need to fetch a new question)
    key_points = body.key_points
    common_mistakes = body.common_mistakes

    async def event_stream():
        try:
            yield _ndjson({"type": "stage", "stage": "scoring"})
            score_result = await grading.grade_score(
                body.question, body.answer_text, key_points, common_mistakes
            )
            # New two-track scores event
            yield _ndjson({
                "type": "scores",
                "knowledge_score": score_result["knowledge_score"],
                "response_score": score_result["response_score"],
            })

            yield _ndjson({"type": "stage", "stage": "speaking"})
            feedback_parts: list[str] = []
            async for token in grading.stream_delivery(
                body.question, body.answer_text, body.persona, score_result
            ):
                feedback_parts.append(token)
                yield _ndjson({"type": "token", "text": token})
            feedback = "".join(feedback_parts).strip()

            attempt_id = await run_in_threadpool(
                db.insert_attempt,
                category=body.category,
                persona=body.persona,
                question=body.question,
                answer_text=body.answer_text,
                score=score_result["score"],
                knowledge_score=score_result["knowledge_score"],
                response_score=score_result["response_score"],
                strengths=score_result["strengths"],
                gaps=score_result["missed_points"],  # gaps = missed_points for compat
                suggestions=score_result["suggestions"],
                feedback=feedback,
                follow_up_question=None,
                model_answer=score_result["model_answer"],
            )
            yield _ndjson({"type": "done", "id": attempt_id})
        except Exception as exc:  # noqa: BLE001 - surface any failure to the client
            import traceback
            error_msg = str(exc)
            # Log full traceback to terminal
            print(f"[GRADING ERROR] {error_msg}")
            traceback.print_exc()

            # Provide user-friendly error messages
            if "GROQ_API_KEY not set" in error_msg or "GROQ_API_KEY" in error_msg:
                user_msg = "GROQ_API_KEY missing — set it in .env or environment"
            elif "Rate limited" in error_msg or "rate limited" in error_msg.lower() or "429" in error_msg:
                user_msg = "Rate limited by provider — try again in a moment"
            elif "model_not_found" in error_msg or "does not exist" in error_msg:
                user_msg = "Model not available — check GROQ_FAST_MODEL / GROQ_GRADING_MODEL in config"
            elif "Could not parse JSON" in error_msg or "invalid JSON" in error_msg.lower():
                user_msg = "Model returned invalid JSON — try again"
            elif "All connection attempts failed" in error_msg:
                user_msg = "Could not reach LLM provider — check network and API key"
            else:
                user_msg = f"Grading failed: {error_msg}"

            yield _ndjson({"type": "error", "message": user_msg})

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@app.get("/api/history", response_model=list[AttemptSummary])
def get_history():
    return db.list_attempts()


@app.get("/api/history/{attempt_id}", response_model=AttemptDetail)
def get_history_detail(attempt_id: int):
    attempt = db.get_attempt(attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return attempt
