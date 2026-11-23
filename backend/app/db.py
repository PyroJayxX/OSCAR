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
    knowledge_score INTEGER,
    response_score INTEGER,
    strengths TEXT NOT NULL,
    gaps TEXT NOT NULL,
    suggestions TEXT NOT NULL,
    feedback TEXT NOT NULL,
    follow_up_question TEXT,
    model_answer TEXT
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


def _run_migration(conn: sqlite3.Connection) -> None:
    """Add new columns to existing database if they don't exist."""
    # Check current columns
    cursor = conn.execute("PRAGMA table_info(attempts)")
    columns = {row[1] for row in cursor.fetchall()}

    migrations = [
        ("knowledge_score", "INTEGER"),
        ("response_score", "INTEGER"),
        ("model_answer", "TEXT"),
    ]

    for col_name, col_type in migrations:
        if col_name not in columns:
            try:
                conn.execute(f"ALTER TABLE attempts ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                # Column might have been added concurrently, ignore
                pass

    # Backfill existing rows: derive knowledge/response scores from legacy score
    if "knowledge_score" in columns or "response_score" in columns:
        # Check if any rows have NULL knowledge_score
        cursor = conn.execute(
            "SELECT COUNT(*) FROM attempts WHERE knowledge_score IS NULL"
        )
        if cursor.fetchone()[0] > 0:
            # Heuristic: split legacy 0-100 score into two 0-10 scores
            conn.execute(
                """
                UPDATE attempts
                SET knowledge_score = CAST(score / 10 AS INTEGER),
                    response_score = CAST(score / 10 AS INTEGER)
                WHERE knowledge_score IS NULL OR response_score IS NULL
                """
            )


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(SCHEMA)
        _run_migration(conn)


def insert_attempt(
    category: str,
    persona: str,
    question: str,
    answer_text: str,
    score: int,
    knowledge_score: int,
    response_score: int,
    strengths: list[str],
    gaps: list[str],
    suggestions: list[str],
    feedback: str,
    follow_up_question: str | None,
    model_answer: str | None,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO attempts
                (created_at, category, persona, question, answer_text, score,
                 knowledge_score, response_score,
                 strengths, gaps, suggestions, feedback, follow_up_question, model_answer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(),
                category,
                persona,
                question,
                answer_text,
                score,
                knowledge_score,
                response_score,
                json.dumps(strengths),
                json.dumps(gaps),
                json.dumps(suggestions),
                feedback,
                follow_up_question,
                model_answer,
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
        "knowledge_score": row["knowledge_score"],
        "response_score": row["response_score"],
        "strengths": json.loads(row["strengths"]),
        "gaps": json.loads(row["gaps"]),
        "suggestions": json.loads(row["suggestions"]),
        "feedback": row["feedback"],
        "follow_up_question": row["follow_up_question"],
        "model_answer": row["model_answer"],
    }


def list_attempts() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, created_at, category, persona, question, score, knowledge_score, response_score "
            "FROM attempts ORDER BY id DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def get_attempt(attempt_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM attempts WHERE id = ?", (attempt_id,)
        ).fetchone()
        return _row_to_detail(row) if row else None
