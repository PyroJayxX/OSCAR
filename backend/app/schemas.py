from typing import Optional

from pydantic import BaseModel


class CategoryOut(BaseModel):
    id: str
    label: str


class PersonaOut(BaseModel):
    id: str
    label: str
    description: str


class QuestionOut(BaseModel):
    category: str
    question: str
    difficulty: str | None = None
    type: str | None = None
    key_points: list[str] = []
    common_mistakes: list[str] = []


class GenerateQuestionIn(BaseModel):
    category: str


class TranscribeOut(BaseModel):
    text: str


class GradeIn(BaseModel):
    category: str
    persona: str
    question: str
    answer_text: str
    key_points: list[str] = []
    common_mistakes: list[str] = []


class AttemptSummary(BaseModel):
    id: int
    created_at: str
    category: str
    persona: str
    question: str
    score: int
    knowledge_score: Optional[int] = None
    response_score: Optional[int] = None


class AttemptDetail(AttemptSummary):
    answer_text: str
    strengths: list[str]
    gaps: list[str]
    suggestions: list[str]
    feedback: str
    follow_up_question: Optional[str] = None
    model_answer: Optional[str] = None
