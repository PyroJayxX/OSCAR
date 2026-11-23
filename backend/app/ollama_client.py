import json
import re

import httpx

from app.config import MODEL_NAME, OLLAMA_URL

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)

# Ollama's grammar-constrained "format": "json" mode is dramatically slower on
# partial CPU/GPU offload hardware (observed: 12s vs 300s+ timeout for an
# identical prompt), so JSON is requested via the prompt instead and parsed
# defensively here.
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)
_BRACES_RE = re.compile(r"\{.*\}", re.DOTALL)

# JSON never uses a bare ")" as a structural character, and never places one
# right after a string's closing quote - so a quote followed by stray ")"
# before the next real delimiter is unambiguously model noise (observed: an
# extra ")" echoed from a parenthetical aside inside the preceding string,
# e.g. '..."...)" ) ]' instead of '..."...)"]'). Safe to strip unconditionally.
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


def chat_json(system_prompt: str, user_prompt: str, temperature: float = 0.3) -> dict:
    """Call Ollama's chat API and parse a JSON object out of the response."""
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "think": False,
        "options": {"temperature": temperature, "num_ctx": 8192, "num_predict": 1024},
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return _extract_json(data["message"]["content"])


async def achat_stream(system_prompt: str, user_prompt: str, temperature: float = 0.6):
    """Call Ollama's chat API with streaming and yield plain-text content deltas
    as they arrive, so the caller can forward tokens to a client in real time."""
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": True,
        "think": False,
        "options": {"temperature": temperature, "num_ctx": 8192, "num_predict": 1024},
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
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
