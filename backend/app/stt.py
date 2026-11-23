import io

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

from app.config import WHISPER_MODEL_SIZE

_TARGET_SAMPLE_RATE = 16000

_model: WhisperModel | None = None


def _resample_linear(data: np.ndarray, orig_rate: int, target_rate: int) -> np.ndarray:
    if orig_rate == target_rate:
        return data
    duration = len(data) / orig_rate
    target_len = int(round(duration * target_rate))
    orig_x = np.linspace(0, duration, num=len(data), endpoint=False)
    target_x = np.linspace(0, duration, num=target_len, endpoint=False)
    return np.interp(target_x, orig_x, data).astype("float32")


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    return _model


def transcribe(wav_bytes: bytes) -> str:
    """Transcribe WAV audio bytes to text without needing ffmpeg on PATH.

    Decodes the WAV directly via soundfile (libsndfile) into a float32 numpy
    array and feeds that straight to faster-whisper, which accepts numpy audio
    arrays and does not need to shell out to ffmpeg.
    """
    data, samplerate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = _resample_linear(data, samplerate, _TARGET_SAMPLE_RATE)

    model = _get_model()
    segments, _info = model.transcribe(
        data,
        language="en",
        vad_filter=True,
    )
    return " ".join(segment.text.strip() for segment in segments).strip()
