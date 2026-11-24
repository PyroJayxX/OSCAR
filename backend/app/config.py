import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

BACKEND_DIR = Path(__file__).resolve().parent.parent

# LLM Provider
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama")  # "ollama" or "groq"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL_NAME = os.environ.get("OSCAR_MODEL_NAME", "qwen3.5:9b")

# Groq settings
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_FAST_MODEL = os.environ.get("GROQ_FAST_MODEL", "openai/gpt-oss-20b")
GROQ_GRADING_MODEL = os.environ.get("GROQ_GRADING_MODEL", "openai/gpt-oss-120b")

# Piper TTS
PIPER_VOICE = os.environ.get("OSCAR_TTS_VOICE", "en_US-ryan-medium")
PIPER_MODEL_DIR = os.environ.get("PIPER_MODEL_DIR", str(BACKEND_DIR / "piper_models"))

# Whisper STT
WHISPER_MODEL_SIZE = os.environ.get("OSCAR_WHISPER_MODEL_SIZE", "base")
WHISPER_LANGUAGE_HINT = os.environ.get("WHISPER_LANGUAGE_HINT", "")  # e.g., "en", "es"

# Database
DB_PATH = os.environ.get("OSCAR_DB_PATH", str(BACKEND_DIR / "oscar.db"))
QUESTIONS_PATH = os.environ.get(
    "OSCAR_QUESTIONS_PATH", str(BACKEND_DIR / "app" / "data" / "questions.json")
)

# Timer
DEFAULT_TIMER_SECONDS = int(os.environ.get("DEFAULT_TIMER_SECONDS", "90"))
TIMER_BY_DIFFICULTY = {
    "easy": int(os.environ.get("TIMER_EASY", "120")),
    "medium": int(os.environ.get("TIMER_MEDIUM", "90")),
    "hard": int(os.environ.get("TIMER_HARD", "60")),
}

CORS_ORIGINS = os.environ.get(
    "OSCAR_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
