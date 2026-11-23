import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app import db, grading, personas, questions, stt
from app.config import CORS_ORIGINS, GROQ_API_KEY, LLM_PROVIDER
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

    # Get question details (key_points, common_mistakes) if not provided
    q_details = questions.get_question_details(body.category)
    if q_details is None:
        raise HTTPException(status_code=404, detail="No more questions in this category for this session")
    key_points = body.key_points if body.key_points else q_details.get("key_points", [])
    common_mistakes = body.common_mistakes if body.common_mistakes else q_details.get("common_mistakes", [])

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
            yield _ndjson({"type": "error", "message": str(exc)})

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
