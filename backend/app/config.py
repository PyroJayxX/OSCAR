import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL_NAME = os.environ.get("OSCAR_MODEL_NAME", "qwen3.5:9b")
WHISPER_MODEL_SIZE = os.environ.get("OSCAR_WHISPER_MODEL_SIZE", "base")
DB_PATH = os.environ.get("OSCAR_DB_PATH", str(BACKEND_DIR / "oscar.db"))
QUESTIONS_PATH = os.environ.get(
    "OSCAR_QUESTIONS_PATH", str(BACKEND_DIR / "app" / "data" / "questions.json")
)

CORS_ORIGINS = os.environ.get(
    "OSCAR_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
