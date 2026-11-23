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


class GenerateQuestionIn(BaseModel):
    category: str


class TranscribeOut(BaseModel):
    text: str


class GradeIn(BaseModel):
    category: str
    persona: str
    question: str
    answer_text: str


class AttemptSummary(BaseModel):
    id: int
    created_at: str
    category: str
    persona: str
    question: str
    score: int


class AttemptDetail(AttemptSummary):
    answer_text: str
    strengths: list[str]
    gaps: list[str]
    suggestions: list[str]
    feedback: str
    follow_up_question: Optional[str] = None
