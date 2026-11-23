import json
import random
from pathlib import Path

from app.config import QUESTIONS_PATH

# Category labels for display
CATEGORY_LABELS = {
    "sql": "SQL",
    "python": "Python",
    "ml": "Machine Learning",
    "genai": "GenAI",
    "rest_api": "REST APIs",
    "power_bi": "Power BI",
    "data_basics": "Data Basics",
    "behavioral": "Behavioral",
}

VALID_CATEGORIES = set(CATEGORY_LABELS.keys())

# Load flat question list
with open(QUESTIONS_PATH, encoding="utf-8") as f:
    _QUESTIONS: list[dict] = json.load(f)

# Build index by category (derived from id prefix)
_QUESTIONS_BY_CATEGORY: dict[str, list[dict]] = {}
for q in _QUESTIONS:
    topic = q.get("topic")
    if topic and topic in VALID_CATEGORIES:
        _QUESTIONS_BY_CATEGORY.setdefault(topic, []).append(q)

# Session tracking for no-repeat rule
_used_questions: dict[str, set[str]] = {}


def _reset_session(category: str) -> None:
    """Clear used questions for a category when exhausted."""
    _used_questions[category] = set()


def list_categories() -> list[dict]:
    """Return list of categories with id and label."""
    return [{"id": cat_id, "label": CATEGORY_LABELS[cat_id]} for cat_id in VALID_CATEGORIES]


def is_valid_category(category: str) -> bool:
    return category in VALID_CATEGORIES


def get_questions_for_category(category: str) -> list[dict]:
    """Get all questions for a category."""
    return _QUESTIONS_BY_CATEGORY.get(category, [])


def random_question(category: str, session_id: str = "default") -> dict | None:
    """
    Return a random question from category that hasn't been used in this session.
    Returns None if category is exhausted.
    """
    questions = get_questions_for_category(category)
    if not questions:
        return None

    # Initialize session tracking
    if category not in _used_questions:
        _used_questions[category] = set()

    # Filter out already used questions
    available = [q for q in questions if q["id"] not in _used_questions[category]]

    if not available:
        # Category exhausted - reset and inform caller
        _reset_session(category)
        return None

    selected = random.choice(available)
    _used_questions[category].add(selected["id"])
    return selected


def get_question_details(category: str, session_id: str = "default") -> dict | None:
    """Return full question object with all fields."""
    return random_question(category, session_id)


async def generate_question(category: str) -> str:
    """Generate a question via LLM (fallback to random if fails)."""
    from app.llm_client import llm_chat

    label = CATEGORY_LABELS.get(category, category)
    system_prompt = (
        "You are an experienced technical interviewer. You generate a single, "
        "realistic interview question for a given category. Respond ONLY with "
        'JSON of the form {"question": "..."}. No preamble, no markdown.'
    )
    user_prompt = (
        f"Category: {label}\n"
        "Generate one realistic, specific interview question for this category. "
        "It should be the kind of question actually asked in real interviews - "
        "not generic or vague."
    )
    result = await llm_chat(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=True,
        temperature=0.3,
    )
    question = result.get("question", "").strip()
    if not question:
        q = random_question(category)
        return q["text"] if q else "No questions available for this category."
    return question