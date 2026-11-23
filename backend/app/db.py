import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from app.config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    category TEXT NOT NULL,
    persona TEXT NOT NULL,
    question TEXT NOT NULL,
    answer_text TEXT NOT NULL,
    score INTEGER NOT NULL,
    strengths TEXT NOT NULL,
    gaps TEXT NOT NULL,
    suggestions TEXT NOT NULL,
    feedback TEXT NOT NULL,
    follow_up_question TEXT
);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(SCHEMA)


def insert_attempt(
    category: str,
    persona: str,
    question: str,
    answer_text: str,
    score: int,
    strengths: list[str],
    gaps: list[str],
    suggestions: list[str],
    feedback: str,
    follow_up_question: str | None,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO attempts
                (created_at, category, persona, question, answer_text, score,
                 strengths, gaps, suggestions, feedback, follow_up_question)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(),
                category,
                persona,
                question,
                answer_text,
                score,
                json.dumps(strengths),
                json.dumps(gaps),
                json.dumps(suggestions),
                feedback,
                follow_up_question,
            ),
        )
        return cur.lastrowid


def _row_to_detail(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "category": row["category"],
        "persona": row["persona"],
        "question": row["question"],
        "answer_text": row["answer_text"],
        "score": row["score"],
        "strengths": json.loads(row["strengths"]),
        "gaps": json.loads(row["gaps"]),
        "suggestions": json.loads(row["suggestions"]),
        "feedback": row["feedback"],
        "follow_up_question": row["follow_up_question"],
    }


def list_attempts() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, created_at, category, persona, question, score "
            "FROM attempts ORDER BY id DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def get_attempt(attempt_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM attempts WHERE id = ?", (attempt_id,)
        ).fetchone()
        return _row_to_detail(row) if row else None
