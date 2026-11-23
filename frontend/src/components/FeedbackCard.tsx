import { useEffect, useRef, useState } from "react";
import { Waveform } from "./Waveform";

export type GradeStage = "scoring" | "speaking" | "done" | "error";

interface FeedbackCardProps {
  stage: GradeStage;
  score: number | null;
  question: string;
  narrativeText: string;
  personaLabel: string;
  errorMessage: string | null;
  onNextQuestion: () => void;
  onRetry: () => void;
}

function scoreColor(score: number): string {
  if (score >= 75) return "var(--signal-sage)";
  if (score >= 50) return "var(--signal-amber)";
  return "var(--signal-rose)";
}

function useCountUp(target: number | null, durationMs = 700) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === null) return;
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function useElapsedSeconds(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(performance.now());
  useEffect(() => {
    if (!running) return;
    startRef.current = performance.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - startRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return elapsed;
}

const STAGE_LABEL: Record<GradeStage, string> = {
  scoring: "Reading your answer",
  speaking: "Composing feedback",
  done: "Assessment complete",
  error: "Something went wrong",
};

export function FeedbackCard({
  stage,
  score,
  question,
  narrativeText,
  personaLabel,
  errorMessage,
  onNextQuestion,
  onRetry,
}: FeedbackCardProps) {
  const displayScore = useCountUp(score);
  const elapsed = useElapsedSeconds(stage === "scoring" || stage === "speaking");

  return (
    <div className="panel feedback-card">
      <div className="score-readout">
        {score !== null && (
          <div className="score-number mono" style={{ color: scoreColor(score) }}>
            {displayScore}
            <span className="score-max">/100</span>
          </div>
        )}

        {stage === "scoring" && (
          <div className="thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}

        {stage === "speaking" && <Waveform mode="ambient" />}

        <div className="panel-eyebrow mono stage-label">
          {personaLabel} &mdash; {STAGE_LABEL[stage]}
          {(stage === "scoring" || stage === "speaking") && (
            <span className="stage-timer"> &middot; {elapsed}s</span>
          )}
        </div>
      </div>

      <div className="feedback-question">
        <div className="panel-eyebrow mono">Question</div>
        <p>{question}</p>
      </div>

      {stage === "error" ? (
        <div className="error-banner" role="alert">
          {errorMessage ?? "Grading failed unexpectedly."}
        </div>
      ) : (
        <div className="feedback-response">
          <div className="panel-eyebrow mono">Feedback</div>
          <p className="feedback-narrative">
            {narrativeText}
            {stage === "speaking" && <span className="narrative-cursor" aria-hidden="true" />}
          </p>
        </div>
      )}

      {stage === "error" ? (
        <button className="btn-primary" onClick={onRetry}>
          Try again
        </button>
      ) : (
        <button className="btn-primary" onClick={onNextQuestion} disabled={stage !== "done"}>
          Next question
        </button>
      )}
    </div>
  );
}
