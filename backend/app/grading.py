from typing import Optional

from app.ollama_client import achat_stream, chat_json
from app.personas import get_persona

_SCORE_SYSTEM_PROMPT = (
    "You are an objective technical interview grader. You evaluate a candidate's "
    "spoken answer to an interview question against what a strong answer would "
    "cover. You are neutral and consistent - your score and assessment must not "
    "depend on tone or personality, only on the substance of the answer.\n\n"
    "Score from 0-100 based on correctness, completeness, and depth relative to "
    "what a strong candidate would say for this question.\n\n"
    "Respond ONLY with JSON of this exact shape, no markdown, no preamble:\n"
    '{"score": <int 0-100>, '
    '"strengths": ["specific things the answer got right"], '
    '"gaps": ["specific missing or incorrect concepts, citing what was said vs '
    'what was missing and why it matters"], '
    '"suggestions": ["concrete, actionable suggestions for improvement - one per '
    'gap, in the same order as gaps"]}\n\n'
    "Be specific and concrete - cite what the candidate actually said. Avoid "
    "generic feedback."
)

_DELIVERY_SYSTEM_PROMPT_TEMPLATE = (
    "{tone_prompt}\n\n"
    "You will be given an objective grading result (score, strengths, gaps, "
    "suggestions) for a candidate's interview answer. Deliver this feedback out "
    "loud, in your own voice, as natural spoken paragraphs. Never use a list, "
    "bullet points, or markdown - no one talks in bullet points.\n\n"
    "Briefly acknowledge what they got right. Then, for each gap, weave it "
    "together with its fix in the same breath, e.g. 'You mentioned X, but "
    "missed Y - which matters because ... - so next time, try Z.' Don't present "
    "gaps and their suggestions as separate topics; each gap should be "
    "immediately followed by its concrete fix, not listed separately.\n\n"
    "{follow_up_instructions}\n\n"
    "Write 3-6 sentences of flowing spoken feedback. Plain prose only - no "
    "markdown, no headers, no bullet points, nothing but the words you'd "
    "actually say out loud."
)

_FOLLOW_UP_INSTRUCTIONS = (
    "The candidate's score was below the pass threshold for a rapid-fire "
    "interview. End your feedback with one short, pointed follow-up question "
    "that presses on the biggest gap in their answer, asked directly as the "
    "last thing you say."
)
_NO_FOLLOW_UP_INSTRUCTIONS = "Do not ask a follow-up question."


def fact_check(claims: list[str]) -> Optional[str]:
    """Extension point for future SearXNG-backed fact-checking.

    Intended to query a local SearXNG instance to verify technical claims in the
    candidate's answer and return verification notes to fold into the score-call
    prompt. Not implemented yet - returns None (no-op) so grading proceeds on the
    LLM's own knowledge alone.
    """
    return None


def grade_score(question: str, answer_text: str) -> dict:
    """Objective, persona-independent scoring pass. Same rubric prompt every
    time, so the score never depends on which persona is delivering it."""
    score_user_prompt = f"Interview question:\n{question}\n\nCandidate's answer:\n{answer_text}"
    score_result = chat_json(_SCORE_SYSTEM_PROMPT, score_user_prompt, temperature=0.1)

    score = int(score_result["score"])
    score = max(0, min(100, score))
    return {
        "score": score,
        "strengths": list(score_result.get("strengths", [])),
        "gaps": list(score_result.get("gaps", [])),
        "suggestions": list(score_result.get("suggestions", [])),
    }


def wants_follow_up(persona_id: str, score: int) -> bool:
    threshold = get_persona(persona_id).get("follow_up_threshold")
    return threshold is not None and score < threshold


async def stream_delivery(question: str, answer_text: str, persona_id: str, score_result: dict):
    """Streams the persona-toned narrative feedback token by token. Narrates the
    already-computed score_result; never recomputes or changes the score."""
    persona = get_persona(persona_id)
    follow_up = wants_follow_up(persona_id, score_result["score"])

    delivery_system_prompt = _DELIVERY_SYSTEM_PROMPT_TEMPLATE.format(
        tone_prompt=persona["tone_prompt"],
        follow_up_instructions=_FOLLOW_UP_INSTRUCTIONS if follow_up else _NO_FOLLOW_UP_INSTRUCTIONS,
    )
    delivery_user_prompt = (
        f"Interview question:\n{question}\n\n"
        f"Candidate's answer:\n{answer_text}\n\n"
        f"Score: {score_result['score']}\n"
        f"Strengths: {score_result['strengths']}\n"
        f"Gaps: {score_result['gaps']}\n"
        f"Suggestions: {score_result['suggestions']}"
    )
    async for token in achat_stream(delivery_system_prompt, delivery_user_prompt, temperature=0.6):
        yield token
