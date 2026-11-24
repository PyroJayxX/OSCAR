import hashlib
import io
import os
import wave
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from app.config import PIPER_MODEL_DIR, PIPER_VOICE


_VOICE_CACHE: dict[str, "PiperVoice"] = {}
_AUDIO_CACHE: dict[str, bytes] = {}


def _get_voice() -> "PiperVoice":
    """Load and cache the Piper voice."""
    global _VOICE_CACHE
    voice_name = PIPER_VOICE
    if voice_name in _VOICE_CACHE:
        return _VOICE_CACHE[voice_name]

    model_dir = Path(PIPER_MODEL_DIR)
    model_path = model_dir / f"{voice_name}.onnx"
    config_path = model_dir / f"{voice_name}.onnx.json"

    if not model_path.exists() or not config_path.exists():
        # Try to download the voice
        try:
            from piper.download_voices import download_voice
            model_dir.mkdir(parents=True, exist_ok=True)
            download_voice(voice_name, model_dir, force_redownload=False)
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"Piper voice '{voice_name}' not found and could not be downloaded: {e}",
            )

    if not model_path.exists() or not config_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Piper voice '{voice_name}' not found at {model_path}. Set OSCAR_TTS_VOICE env var to a valid voice.",
        )

    try:
        from piper import PiperVoice
        voice = PiperVoice.load(str(model_path), str(config_path))
        _VOICE_CACHE[voice_name] = voice
        return voice
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load Piper voice: {e}")


def _text_hash(text: str) -> str:
    """Generate a cache key for the text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def synthesize_wav(text: str) -> bytes:
    """Synthesize text to WAV audio bytes, using cache."""
    cache_key = _text_hash(text)
    if cache_key in _AUDIO_CACHE:
        return _AUDIO_CACHE[cache_key]

    voice = _get_voice()

    # Synthesize to a BytesIO buffer
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)  # mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(voice.config.sample_rate)
        voice.synthesize_wav(text, wav_file)

    wav_bytes = buffer.getvalue()
    _AUDIO_CACHE[cache_key] = wav_bytes
    return wav_bytes


def clear_cache() -> None:
    """Clear the audio cache (useful for testing)."""
    global _AUDIO_CACHE
    _AUDIO_CACHE.clear()