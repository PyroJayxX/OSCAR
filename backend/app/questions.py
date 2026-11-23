import json
import random

from app.config import QUESTIONS_PATH
from app.ollama_client import chat_json

with open(QUESTIONS_PATH, encoding="utf-8") as f:
    _BANK: dict = json.load(f)


def list_categories() -> list[dict]:
    return [{"id": cat_id, "label": cat["label"]} for cat_id, cat in _BANK.items()]


def is_valid_category(category: str) -> bool:
    return category in _BANK


def random_question(category: str) -> str:
    return random.choice(_BANK[category]["questions"])


def generate_question(category: str) -> str:
    label = _BANK[category]["label"]
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
    result = chat_json(system_prompt, user_prompt)
    question = result.get("question", "").strip()
    if not question:
        return random_question(category)
    return question
