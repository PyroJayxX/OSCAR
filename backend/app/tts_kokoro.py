import io
import os
import hashlib
import wave
import numpy as np
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from app.config import KOKORO_MODEL_DIR


_KOKORO_CACHE = {}
_AUDIO_CACHE = {}


def _get_kokoro() -> "Kokoro":
    """Load and cache the Kokoro model."""
    global _KOKORO_CACHE
    model_path = Path(KOKORO_MODEL_DIR) / "kokoro-v0_19.onnx"
    # Use the official voices file from kokoro-onnx releases
    voices_path = Path(KOKORO_MODEL_DIR) / "voices.bin"

    if not model_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Kokoro model not found at {model_path}",
        )
    if not voices_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Kokoro voices not found at {voices_path}",
        )

    if "kokoro" in _KOKORO_CACHE:
        return _KOKORO_CACHE["kokoro"]

    try:
        from kokoro_onnx import Kokoro
        kokoro = Kokoro(str(model_path), str(voices_path))
        _KOKORO_CACHE["kokoro"] = kokoro
        return kokoro
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load Kokoro: {e}")


def _text_hash(text: str, voice: str, speed: float) -> str:
    """Generate a cache key for the text."""
    return hashlib.sha256(f"{text}|{voice}|{speed}".encode("utf-8")).hexdigest()[:16]


def synthesize_wav(text: str, voice: str = "af", speed: float = 1.0) -> bytes:
    """Synthesize text to WAV audio bytes using Kokoro, with cache."""
    cache_key = _text_hash(text, voice, speed)
    if cache_key in _AUDIO_CACHE:
        return _AUDIO_CACHE[cache_key]

    kokoro = _get_kokoro()

    # Check if voice is available
    available_voices = kokoro.get_voices()
    if voice not in available_voices:
        # Default to first available voice
        voice = available_voices[0] if available_voices else "af"

    # Synthesize audio
    audio_array, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")

    # Convert to WAV bytes
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)  # mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        # Convert float32 [-1, 1] to int16
        audio_int16 = (audio_array * 32767).astype(np.int16)
        wav_file.writeframes(audio_int16.tobytes())

    wav_bytes = buffer.getvalue()
    _AUDIO_CACHE[cache_key] = wav_bytes
    return wav_bytes


def get_available_voices() -> list[str]:
    """Get list of available Kokoro voices."""
    kokoro = _get_kokoro()
    return kokoro.get_voices()


def clear_cache() -> None:
    """Clear the audio cache (useful for testing)."""
    global _AUDIO_CACHE
    _AUDIO_CACHE.clear()