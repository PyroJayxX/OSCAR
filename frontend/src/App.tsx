import { useEffect, useState } from "react";
import "./App.css";
import { api, type AttemptSummary, type Category, type Persona } from "./api/client";
import { AnswerPanel } from "./components/AnswerPanel";
import { FeedbackCard, type GradeStage } from "./components/FeedbackCard";
import { HistoryPanel } from "./components/HistoryPanel";
import { QuestionCard } from "./components/QuestionCard";
import { SelectRail } from "./components/SelectRail";

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);

  const [started, setStarted] = useState(false);
  const [question, setQuestion] = useState<string>("");
  const [questionLoading, setQuestionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [gradeStage, setGradeStage] = useState<GradeStage | "idle">("idle");
  const [liveScore, setLiveScore] = useState<number | null>(null);
  const [narrativeText, setNarrativeText] = useState("");
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [lastAnswerText, setLastAnswerText] = useState("");

  const [showHistory, setShowHistory] = useState(false);
  const [historyAttempts, setHistoryAttempts] = useState<AttemptSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    api.getCategories().then(setCategories).catch((e) => setErrorMessage(e.message));
    api.getPersonas().then(setPersonas).catch((e) => setErrorMessage(e.message));
  }, []);

  const fetchQuestion = async (category: string) => {
    setQuestionLoading(true);
    setErrorMessage(null);
    try {
      const result = await api.getQuestion(category);
      setQuestion(result.question);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not load a question");
    } finally {
      setQuestionLoading(false);
    }
  };

  const generateQuestion = async (category: string) => {
    setQuestionLoading(true);
    setErrorMessage(null);
    try {
      const result = await api.generateQuestion(category);
      setQuestion(result.question);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not generate a question");
    } finally {
      setQuestionLoading(false);
    }
  };

  const handleStart = async () => {
    if (!selectedCategory || !selectedPersona) return;
    setStarted(true);
    setGradeStage("idle");
    await fetchQuestion(selectedCategory);
  };

  const runGrading = async (answerText: string) => {
    if (!selectedCategory || !selectedPersona) return;
    setLastAnswerText(answerText);
    setGradeStage("scoring");
    setLiveScore(null);
    setNarrativeText("");
    setGradeError(null);
    try {
      await api.gradeStream(
        { category: selectedCategory, persona: selectedPersona, question, answer_text: answerText },
        (event) => {
          if (event.type === "stage") setGradeStage(event.stage);
          else if (event.type === "score") setLiveScore(event.score);
          else if (event.type === "token") setNarrativeText((t) => t + event.text);
          else if (event.type === "done") setGradeStage("done");
          else if (event.type === "error") {
            setGradeStage("error");
            setGradeError(event.message);
          }
        },
      );
    } catch (e) {
      setGradeStage("error");
      setGradeError(e instanceof Error ? e.message : "Grading failed");
    }
  };

  const handleNextQuestion = async () => {
    setGradeStage("idle");
    if (selectedCategory) await fetchQuestion(selectedCategory);
  };

  const openHistory = async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const attempts = await api.getHistory();
      setHistoryAttempts(attempts);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  };

  const categoryLabel = categories.find((c) => c.id === selectedCategory)?.label ?? "";
  const personaLabel = personas.find((p) => p.id === selectedPersona)?.label ?? "";

  return (
    <div className="app-shell">
      <aside className="console-rail">
        <div className="wordmark">
          <span className="wordmark-text">OSCAR</span>
          <div className="wordmark-sub mono">
            On-the-spot Speech &amp; Communication
            <br />
            Analysis Reviewer
          </div>
        </div>

        <SelectRail
          title="Category"
          items={categories}
          selectedId={selectedCategory}
          onSelect={setSelectedCategory}
        />
        <SelectRail
          title="Interviewer"
          items={personas}
          selectedId={selectedPersona}
          onSelect={setSelectedPersona}
        />

        {!started ? (
          <button
            className="btn-primary rail-start-btn"
            onClick={handleStart}
            disabled={!selectedCategory || !selectedPersona}
          >
            Start session
          </button>
        ) : (
          <button className="btn-ghost rail-start-btn" onClick={handleStart}>
            Restart with this setup
          </button>
        )}

        <button className="btn-ghost history-toggle-btn" onClick={openHistory}>
          View history
        </button>
      </aside>

      <main className="stage">
        <div className="stage-inner">
          {errorMessage && (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          )}

          {!started && (
            <div className="stage-empty">
              <p className="text-secondary">
                Pick a category and an interviewer on the left, then start your session.
              </p>
            </div>
          )}

          {started && gradeStage === "idle" && (
            <div className="stage-stack">
              <QuestionCard
                categoryLabel={categoryLabel}
                question={question}
                loading={questionLoading}
                onNewFromBank={() => selectedCategory && fetchQuestion(selectedCategory)}
                onGenerate={() => selectedCategory && generateQuestion(selectedCategory)}
              />
              <AnswerPanel onSubmit={runGrading} />
            </div>
          )}

          {started && gradeStage !== "idle" && (
            <FeedbackCard
              stage={gradeStage}
              score={liveScore}
              question={question}
              narrativeText={narrativeText}
              personaLabel={personaLabel}
              errorMessage={gradeError}
              onNextQuestion={handleNextQuestion}
              onRetry={() => runGrading(lastAnswerText)}
            />
          )}
        </div>
      </main>

      {showHistory && (
        <div className="history-overlay" onClick={() => setShowHistory(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <HistoryPanel
              attempts={historyAttempts}
              loading={historyLoading}
              onClose={() => setShowHistory(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
