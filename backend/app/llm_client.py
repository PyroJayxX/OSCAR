"""
Unified LLM client supporting both Ollama and Groq providers.
All existing code should call only the functions in this module.
"""
import asyncio
import json
import re
import time
from typing import Any, Optional

import httpx
from pydantic import BaseModel, ValidationError

from app.config import (
    GROQ_API_KEY,
    GROQ_FAST_MODEL,
    GROQ_GRADING_MODEL,
    LLM_PROVIDER,
    MODEL_NAME,
    OLLAMA_URL,
)


class LLMError(Exception):
    """Raised when LLM call fails after retries/fallback."""

    def __init__(self, message: str, provider: str, fallback_used: bool = False):
        super().__init__(message)
        self.provider = provider
        self.fallback_used = fallback_used


# JSON extraction patterns (from ollama_client.py)
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)
_BRACES_RE = re.compile(r"\{.*\}", re.DOTALL)
_STRAY_PAREN_RE = re.compile(r'"\s*\)+\s*(?=[,\]}])')


def _strip_stray_parens(text: str) -> str:
    return _STRAY_PAREN_RE.sub('"', text)


def _close_unbalanced_json(text: str) -> str:
    """Append closing brackets/quote to repair JSON the model cut off after a
    premature stop token (observed: valid content, missing trailing braces)."""
    stack = []
    in_string = False
    escape = False
    for ch in text:
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if stack:
                stack.pop()
    if in_string:
        text += '"'
    closers = {"{": "}", "[": "]"}
    while stack:
        text += closers[stack.pop()]
    return text


def _extract_json(content: str) -> dict:
    content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    fence_match = _JSON_FENCE_RE.search(content)
    if fence_match:
        return json.loads(fence_match.group(1))

    brace_match = _BRACES_RE.search(content)
    if brace_match:
        return json.loads(brace_match.group(0))

    start = content.find("{")
    if start != -1:
        candidate = _strip_stray_parens(content[start:])
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        try:
            return json.loads(_close_unbalanced_json(candidate))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from model response: {content!r}")


async def _call_ollama(
    messages: list[dict], temperature: float, json_mode: bool, model: str
) -> str:
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "think": False,
        "options": {"temperature": temperature, "num_ctx": 8192, "num_predict": 2048},
    }
    if json_mode:
        payload["format"] = "json"

    timeout = httpx.Timeout(120.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data["message"]["content"]


async def _call_groq(
    messages: list[dict], temperature: float, json_mode: bool, model: str
) -> str:
    if not GROQ_API_KEY:
        raise LLMError("GROQ_API_KEY not set", "groq")

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 2048,
        "stream": False,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    timeout = httpx.Timeout(120.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        if resp.status_code == 429:
            raise LLMError("Rate limited", "groq")
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"]


async def _call_with_retry(
    provider: str,
    messages: list[dict],
    temperature: float,
    json_mode: bool,
    model: str,
    max_retries: int = 1,
) -> str:
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            if provider == "ollama":
                return await _call_ollama(messages, temperature, json_mode, model)
            elif provider == "groq":
                return await _call_groq(messages, temperature, json_mode, model)
            else:
                raise LLMError(f"Unknown provider: {provider}", provider)
        except LLMError as e:
            last_error = e
            if e.provider == "groq" and "Rate limited" in str(e):
                if attempt < max_retries:
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                # Fallback to Ollama
                if LLM_PROVIDER != "ollama" and OLLAMA_URL:
                    try:
                        return await _call_ollama(
                            messages, temperature, json_mode, MODEL_NAME
                        )
                    except Exception:
                        pass
            raise
        except httpx.HTTPStatusError as e:
            last_error = LLMError(f"HTTP {e.response.status_code}", provider)
            if e.response.status_code == 429 and provider == "groq":
                if attempt < max_retries:
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
            raise
        except Exception as e:
            last_error = LLMError(str(e), provider)
            if attempt < max_retries:
                await asyncio.sleep(1)
                continue
            raise

    raise last_error or LLMError("Unknown error", provider)


async def llm_chat(
    messages: list[dict],
    json_mode: bool = False,
    temperature: float = 0.3,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    response_model: Optional[type[BaseModel]] = None,
) -> dict | BaseModel:
    """
    Unified LLM call for Ollama or Groq.

    Args:
        messages: List of {"role": "...", "content": "..."} dicts
        json_mode: Request JSON output and parse/validate it
        temperature: Sampling temperature
        provider: "ollama" or "groq" (defaults to LLM_PROVIDER from config)
        model: Override model name (uses provider-specific defaults)
        response_model: Optional Pydantic model to validate JSON output

    Returns:
        Parsed dict (or Pydantic model instance if response_model provided)

    Raises:
        LLMError: On failure after retries/fallback
    """
    provider = provider or LLM_PROVIDER

    # Select model based on provider and use case
    if model is None:
        if provider == "groq":
            # Default to fast model; caller should override for grading
            model = GROQ_FAST_MODEL
        else:
            model = MODEL_NAME

    content = await _call_with_retry(provider, messages, temperature, json_mode, model)

    if not json_mode:
        return {"content": content}

    data = _extract_json(content)

    if response_model:
        try:
            return response_model(**data)
        except ValidationError as e:
            # Retry once with stricter prompt
            retry_messages = messages + [
                {
                    "role": "user",
                    "content": f"Previous response was invalid JSON. Error: {e}. Respond ONLY with valid JSON matching the schema.",
                }
            ]
            content = await _call_with_retry(
                provider, retry_messages, temperature, json_mode, model
            )
            data = _extract_json(content)
            return response_model(**data)

    return data


async def llm_stream(
    messages: list[dict],
    temperature: float = 0.6,
    provider: Optional[str] = None,
    model: Optional[str] = None,
):
    """Stream tokens from LLM (for persona delivery)."""
    provider = provider or LLM_PROVIDER

    if model is None:
        if provider == "groq":
            model = GROQ_FAST_MODEL
        else:
            model = MODEL_NAME

    if provider == "ollama":
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "think": False,
            "options": {"temperature": temperature, "num_ctx": 8192, "num_predict": 2048},
        }
        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    delta = data.get("message", {}).get("content", "")
                    if delta:
                        yield delta
                    if data.get("done"):
                        break
    elif provider == "groq":
        if not GROQ_API_KEY:
            raise LLMError("GROQ_API_KEY not set", "groq")
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": 2048,
            "stream": True,
        }
        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", "https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip() or line.startswith(": "):
                        continue
                    if line.startswith("data: "):
                        line = line[6:]
                    if line.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(line)
                        delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
                    except json.JSONDecodeError:
                        continue
    else:
        raise LLMError(f"Unknown provider: {provider}", provider)


def get_provider_info() -> dict:
    """Return current provider configuration for display."""
    return {
        "provider": LLM_PROVIDER,
        "ollama_model": MODEL_NAME if LLM_PROVIDER == "ollama" else None,
        "groq_fast_model": GROQ_FAST_MODEL if LLM_PROVIDER == "groq" else None,
        "groq_grading_model": GROQ_GRADING_MODEL if LLM_PROVIDER == "groq" else None,
    }