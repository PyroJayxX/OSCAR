from typing import Optional

from app.llm_client import llm_chat, llm_stream
from app.personas import get_persona

_SCORE_SYSTEM_PROMPT = (
    "You are an objective technical interview grader. You evaluate a candidate's "
    "spoken answer to an interview question against the provided key points and common mistakes. "
    "You are neutral and consistent - your assessment must not depend on tone or personality, "
    "only on the substance of the answer.\n\n"
    "You will output TWO independent scores (0-10 each):\n"
    "1. knowledge_score (0-10): Factual correctness and completeness against the question's key_points.\n"
    "   - 10: All key points covered accurately and completely\n"
    "   - 7-9: Most key points covered, minor gaps\n"
    "   - 4-6: Some key points covered, significant gaps or errors\n"
    "   - 1-3: Few key points covered, major errors\n"
    "   - 0: No key points addressed or completely incorrect\n\n"
    "2. response_score (0-10): Quality of reasoning, honesty, structure, and communication.\n"
    "   - Rewards: clear reasoning, connecting concepts, admitting uncertainty honestly, "
    "     asking clarifying questions, proposing a learning plan, good structure/clarity\n"
    "   - Penalizes: confident but incorrect claims, rambling, no structure, "
    "     pretending to know what they don't\n"
    "   - CRITICAL: An honest 'I'm not sure, but here's how I'd approach it...' "
    "     scores HIGHER on response_score than a confident wrong answer.\n\n"
    "Grade against the provided key_points and common_mistakes, NOT your subjective opinion.\n\n"
    "Respond ONLY with JSON of this exact shape, no markdown, no preamble:\n"
    '{"knowledge_score": <int 0-10>, '
    '"response_score": <int 0-10>, '
    '"strengths": ["specific things the answer got right, citing key_points"], '
    '"missed_points": ["specific missing/incorrect concepts citing key_points and what was said vs missing"], '
    '"reasoning_feedback": "detailed feedback on reasoning, honesty, structure, clarity - '
    'include a short example of a good \'I\'m not sure\' answer when knowledge_score is low", '
    '"model_answer": "a strong example answer showing full key_points coverage"}\n\n'
    "Be specific and concrete - cite what the candidate actually said. Avoid generic feedback."
)

_DELIVERY_SYSTEM_PROMPT_TEMPLATE = (
    "{tone_prompt}\n\n"
    "You will be given an objective grading result (knowledge_score, response_score, "
    "strengths, missed_points, reasoning_feedback, model_answer) for a candidate's "
    "interview answer. Deliver this feedback out loud, in your own voice, as natural "
    "spoken paragraphs. Never use a list, bullet points, or markdown - no one talks in "
    "bullet points.\n\n"
    "Start by stating both scores clearly: 'Knowledge: X out of 10. Response: Y out of 10.'\n"
    "Then briefly acknowledge what they got right. For each missed point, weave it "
    "together with its fix in the same breath, e.g. 'You mentioned X, but missed Y - "
    "which matters because ... - so next time, try Z.' Don't present missed points "
    "and their suggestions as separate topics; each should be immediately followed by "
    "its concrete fix, not listed separately.\n\n"
    "Include the reasoning_feedback naturally in your narration.\n\n"
    "If knowledge_score is low (below 5), mention the model_answer as a learning reference: "
    "'For reference, a strong answer would cover: [model_answer]'\n\n"
    "{follow_up_instructions}\n\n"
    "Write 3-6 sentences of flowing spoken feedback. Plain prose only - no "
    "markdown, no headers, no bullet points, nothing but the words you'd "
    "actually say out loud."
)

_FOLLOW_UP_INSTRUCTIONS = (
    "The candidate's knowledge_score was below the pass threshold for a rapid-fire "
    "interview. End your feedback with one short, pointed follow-up question "
    "that presses on the biggest gap in their answer, asked directly as the "
    "last thing you say."
)
_NO_FOLLOW_UP_INSTRUCTIONS = "Do not ask a follow-up question."


async def grade_score(question: str, answer_text: str, key_points: list[str], common_mistakes: list[str]) -> dict:
    """Objective, persona-independent scoring pass. Same rubric prompt every
    time, so the score never depends on which persona is delivering it."""

    key_points_text = "\n".join(f"- {kp}" for kp in key_points) if key_points else "None provided"
    common_mistakes_text = "\n".join(f"- {cm}" for cm in common_mistakes) if common_mistakes else "None provided"

    score_user_prompt = (
        f"Interview question:\n{question}\n\n"
        f"Key points to cover:\n{key_points_text}\n\n"
        f"Common mistakes to watch for:\n{common_mistakes_text}\n\n"
        f"Candidate's answer:\n{answer_text}"
    )

    # Use the unified llm_chat with JSON mode
    score_result = await llm_chat(
        messages=[
            {"role": "system", "content": _SCORE_SYSTEM_PROMPT},
            {"role": "user", "content": score_user_prompt},
        ],
        json_mode=True,
        temperature=0.1,
    )

    knowledge_score = int(score_result.get("knowledge_score", 0))
    knowledge_score = max(0, min(10, knowledge_score))
    response_score = int(score_result.get("response_score", 0))
    response_score = max(0, min(10, response_score))

    # Legacy combined score for backward compatibility (0-100)
    score = (knowledge_score + response_score) * 5

    return {
        "score": score,
        "knowledge_score": knowledge_score,
        "response_score": response_score,
        "strengths": list(score_result.get("strengths", [])),
        "missed_points": list(score_result.get("missed_points", [])),
        "reasoning_feedback": score_result.get("reasoning_feedback", ""),
        "model_answer": score_result.get("model_answer", ""),
        # Backward compat aliases
        "gaps": list(score_result.get("missed_points", [])),
        "suggestions": [],  # No longer used; reasoning_feedback covers this
    }


def wants_follow_up(persona_id: str, knowledge_score: int) -> bool:
    """Rapid-fire follow-up triggers on knowledge_score < 6 (equivalent to old score < 60)."""
    persona = get_persona(persona_id)
    threshold = persona.get("follow_up_threshold")
    if threshold is None:
        return False
    # Convert old 0-100 threshold to 0-10 scale
    # rapid_fire has threshold=60, so knowledge_threshold = 6
    knowledge_threshold = threshold // 10
    return knowledge_score < knowledge_threshold


async def stream_delivery(question: str, answer_text: str, persona_id: str, score_result: dict):
    """Streams the persona-toned narrative feedback token by token. Narrates the
    already-computed score_result; never recomputes or changes the score."""
    persona = get_persona(persona_id)
    follow_up = wants_follow_up(persona_id, score_result["knowledge_score"])

    delivery_system_prompt = _DELIVERY_SYSTEM_PROMPT_TEMPLATE.format(
        tone_prompt=persona["tone_prompt"],
        follow_up_instructions=_FOLLOW_UP_INSTRUCTIONS if follow_up else _NO_FOLLOW_UP_INSTRUCTIONS,
    )

    delivery_user_prompt = (
        f"Interview question:\n{question}\n\n"
        f"Candidate's answer:\n{answer_text}\n\n"
        f"Knowledge Score: {score_result['knowledge_score']}/10\n"
        f"Response Score: {score_result['response_score']}/10\n"
        f"Strengths: {score_result['strengths']}\n"
        f"Missed Points: {score_result['missed_points']}\n"
        f"Reasoning Feedback: {score_result['reasoning_feedback']}\n"
        f"Model Answer: {score_result['model_answer']}"
    )

    async for token in llm_stream(
        messages=[
            {"role": "system", "content": delivery_system_prompt},
            {"role": "user", "content": delivery_user_prompt},
        ],
        temperature=0.6,
    ):
        yield token