const BASE_URL = "http://localhost:8000";

export interface Category {
  id: string;
  label: string;
}

export interface Persona {
  id: string;
  label: string;
  description: string;
}

export interface Question {
  category: string;
  question: string;
  difficulty?: string | null;
  type?: string | null;
  key_points: string[];
  common_mistakes: string[];
}

export type GradeStreamEvent =
  | { type: "stage"; stage: "scoring" | "speaking" }
  | { type: "scores"; knowledge_score: number; response_score: number }
  | { type: "token"; text: string }
  | { type: "done"; id: number }
  | { type: "error"; message: string };

export interface AttemptSummary {
  id: number;
  created_at: string;
  category: string;
  persona: string;
  question: string;
  score: number;
  knowledge_score: number | null;
  response_score: number | null;
}

export interface AttemptDetail extends AttemptSummary {
  answer_text: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  feedback: string;
  follow_up_question: string | null;
  model_answer: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore parse failure, fall back to statusText
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getCategories: () => request<Category[]>("/api/categories"),

  getPersonas: () => request<Persona[]>("/api/personas"),

  getQuestion: (category: string) =>
    request<Question>(`/api/question?category=${encodeURIComponent(category)}`),

  generateQuestion: (category: string) =>
    request<Question>("/api/question/generate", {
      method: "POST",
      body: JSON.stringify({ category }),
    }),

  transcribe: (wavBlob: Blob) => {
    const form = new FormData();
    form.append("file", wavBlob, "answer.wav");
    return request<{ text: string }>("/api/transcribe", {
      method: "POST",
      body: form,
    });
  },

  gradeStream: async (
    params: { category: string; persona: string; question: string; answer_text: string; key_points: string[]; common_mistakes: string[] },
    onEvent: (event: GradeStreamEvent) => void,
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}/api/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok || !res.body) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        // ignore parse failure, fall back to statusText
      }
      throw new Error(detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) onEvent(JSON.parse(line) as GradeStreamEvent);
      }
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer.trim()) as GradeStreamEvent);
  },

  getHistory: () => request<AttemptSummary[]>("/api/history"),

  getHistoryDetail: (id: number) => request<AttemptDetail>(`/api/history/${id}`),
};
