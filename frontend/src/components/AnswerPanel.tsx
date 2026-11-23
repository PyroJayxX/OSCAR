import { useState } from "react";
import { api } from "../api/client";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { Waveform } from "./Waveform";

interface AnswerPanelProps {
  onSubmit: (answerText: string) => void;
}

type Mode = "record" | "type";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AnswerPanel({ onSubmit }: AnswerPanelProps) {
  const [mode, setMode] = useState<Mode>("record");
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const recorder = useAudioRecorder();

  const handleToggleRecord = async () => {
    if (recorder.status === "recording") {
      const blob = await recorder.stopRecording();
      if (!blob) return;
      setIsTranscribing(true);
      setTranscribeError(null);
      try {
        const result = await api.transcribe(blob);
        setTranscript((prev) => (prev ? `${prev} ${result.text}` : result.text));
      } catch (err) {
        setTranscribeError(err instanceof Error ? err.message : "Transcription failed");
      } finally {
        setIsTranscribing(false);
      }
    } else {
      recorder.reset();
      await recorder.startRecording();
    }
  };

  const canSubmit = transcript.trim().length > 0 && !isTranscribing;

  return (
    <div className="panel answer-panel">
      <div className="answer-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mode === "record"}
          className={`answer-tab ${mode === "record" ? "answer-tab--active" : ""}`}
          onClick={() => setMode("record")}
        >
          Record
        </button>
        <button
          role="tab"
          aria-selected={mode === "type"}
          className={`answer-tab ${mode === "type" ? "answer-tab--active" : ""}`}
          onClick={() => setMode("type")}
        >
          Type
        </button>
      </div>

      {mode === "record" && (
        <div className="record-block">
          <Waveform
            mode={recorder.status === "recording" ? "live" : "flat"}
            getAnalyser={recorder.getAnalyser}
          />
          <div className="record-controls">
            <button
              className={`record-btn ${recorder.status === "recording" ? "record-btn--active" : ""}`}
              onClick={handleToggleRecord}
              disabled={isTranscribing}
            >
              <span className="record-btn-dot" aria-hidden="true" />
              {recorder.status === "recording" ? "Stop" : "Record answer"}
            </button>
            <span className="record-timer mono">
              {recorder.status === "recording"
                ? formatDuration(recorder.durationSeconds)
                : isTranscribing
                  ? "transcribing…"
                  : ""}
            </span>
          </div>
          {recorder.error && <p className="field-error">{recorder.error}</p>}
          {transcribeError && <p className="field-error">{transcribeError}</p>}
        </div>
      )}

      <label className="transcript-label mono" htmlFor="answer-text">
        {mode === "record" ? "Transcript (edit if needed)" : "Your answer"}
      </label>
      <textarea
        id="answer-text"
        className="transcript-input"
        rows={6}
        value={transcript}
        placeholder={
          mode === "record"
            ? "Recorded speech will appear here — you can fix any transcription errors before submitting."
            : "Type your answer here…"
        }
        onChange={(e) => setTranscript(e.target.value)}
      />

      <button
        className="btn-primary submit-btn"
        onClick={() => onSubmit(transcript.trim())}
        disabled={!canSubmit}
      >
        Submit answer
      </button>
    </div>
  );
}
