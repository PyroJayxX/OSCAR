import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";
import { api, type AttemptSummary, type Category, type Persona } from "./api/client";
import { Waveform, SimulateToggle } from "./components/Waveform";

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);

  const [question, setQuestion] = useState<string>("");
  const [questionKeyPoints, setQuestionKeyPoints] = useState<string[]>([]);
  const [questionCommonMistakes, setQuestionCommonMistakes] = useState<string[]>([]);
  const [questionDifficulty, setQuestionDifficulty] = useState<string | null>(null);
  const [questionType, setQuestionType] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasSetup = selectedCategory && selectedPersona;

  const [gradeStage, setGradeStage] = useState<"scoring" | "speaking" | "done" | "error" | "idle">("idle");
  const [narrativeText, setNarrativeText] = useState("");
  const [lastAnswerText, setLastAnswerText] = useState("");
  const [_knowledgeScore, setKnowledgeScore] = useState<number | null>(null);
  const [_responseScore, setResponseScore] = useState<number | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [historyAttempts, setHistoryAttempts] = useState<AttemptSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [answerMode, setAnswerMode] = useState<"record" | "type">("record");
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  // Live transcript lines (max 4, AI + user alternating)
  const [transcriptLines, setTranscriptLines] = useState<Array<{ text: string; isUser: boolean }>>([]);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Audio recorder state
  const [recorderStatus, setRecorderStatus] = useState<"idle" | "recording">("idle");
  const [recorderDuration, setRecorderDuration] = useState(0);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<number | null>(null);

  // Floating menu state for mobile
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);
  const [showTopicMenu, setShowTopicMenu] = useState(false);

  // Dev-only simulate speaking
  const [simulateSpeaking, setSimulateSpeaking] = useState(false);

  // TTS audio playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try {
      return localStorage.getItem("oscar_tts_enabled") !== "false";
    } catch {
      return true;
    }
  });
  const [showPlayButton, setShowPlayButton] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    api.getCategories().then(setCategories).catch((e) => setErrorMessage(e.message));
    api.getPersonas().then(setPersonas).catch((e) => setErrorMessage(e.message));
  }, []);

  // Load initial question when both category and persona are selected
  useEffect(() => {
    if (hasSetup && !question) {
      fetchQuestion(selectedCategory!);
    }
  }, [selectedCategory, selectedPersona]);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcriptLines]);

  // Audio event handlers
  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
    setShowPlayButton(true); // Show replay/play button after audio finishes
  }, []);

  const handleAudioError = useCallback(() => {
    setIsPlaying(false);
    setShowPlayButton(true);
    console.error("Audio error");
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.load();
      }
    };
  }, []);

  const fetchQuestion = async (category: string) => {
    setErrorMessage(null);
    try {
      const result = await api.getQuestion(category);
      setQuestion(result.question);
      setQuestionKeyPoints(result.key_points || []);
      setQuestionCommonMistakes(result.common_mistakes || []);
      // Store difficulty and type for display
      setQuestionDifficulty(result.difficulty || null);
      setQuestionType(result.type || null);

      // Fetch TTS audio for the new question (don't auto-play until user clicks Start)
      if (ttsEnabled && result.question) {
        await fetchAndPlayTTS(result.question, false);
      }
    } catch (e) {
      // Handle "no more questions" case
      if (e instanceof Error && e.message.includes("No more questions")) {
        setErrorMessage("You've completed all questions in this category for this session!");
      } else {
        setErrorMessage(e instanceof Error ? e.message : "Could not load a question");
      }
      setQuestion("");
      setQuestionKeyPoints([]);
      setQuestionCommonMistakes([]);
      setQuestionDifficulty(null);
      setQuestionType(null);
    }
  };

  const fetchAndPlayTTS = async (text: string, autoPlay = false) => {
    if (!ttsEnabled) return;

    try {
      // Clean up previous audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.load();
      }

      const audio = new Audio();
      audioRef.current = audio;
      audio.onended = handleAudioEnded;
      audio.onerror = handleAudioError;

      const response = await fetch(`http://localhost:8000/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error("TTS request failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      audio.src = url;

      // Only try to autoplay if user has clicked Start or it's a replay
      if (autoPlay) {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setIsPlaying(true);
              setShowPlayButton(false);
            })
            .catch(() => {
              // Autoplay blocked - show play button
              setShowPlayButton(true);
              setIsPlaying(false);
            });
        }
      } else {
        // Don't autoplay - show play button
        setShowPlayButton(true);
        setIsPlaying(false);
      }
    } catch (err) {
      console.error("TTS fetch/play error:", err);
      setShowPlayButton(true);
    }
  };

  const handlePlayQuestion = async () => {
    if (!question || !ttsEnabled) return;
    await fetchAndPlayTTS(question, true);
  };

  const handleReplayQuestion = async () => {
    if (!question || !ttsEnabled) return;
    await fetchAndPlayTTS(question, true);
  };

  const toggleTTS = () => {
    const newValue = !ttsEnabled;
    setTtsEnabled(newValue);
    try {
      localStorage.setItem("oscar_tts_enabled", String(newValue));
    } catch {
      // ignore localStorage errors
    }
    if (newValue && question && !isPlaying && !showPlayButton) {
      fetchAndPlayTTS(question);
    } else if (!newValue && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const runGrading = async (answerText: string) => {
    if (!selectedCategory || !selectedPersona) return;
    setLastAnswerText(answerText);
    setGradeStage("scoring");
    setNarrativeText("");
    setKnowledgeScore(null);
    setResponseScore(null);
    // Add user's answer to transcript
    setTranscriptLines((prev) => [...prev.slice(-3), { text: answerText, isUser: true }]);
    try {
      await api.gradeStream(
        {
          category: selectedCategory,
          persona: selectedPersona,
          question,
          answer_text: answerText,
          key_points: questionKeyPoints,
          common_mistakes: questionCommonMistakes,
        },
        (event) => {
          if (event.type === "stage") setGradeStage(event.stage);
          else if (event.type === "scores") {
            setKnowledgeScore(event.knowledge_score);
            setResponseScore(event.response_score);
          }
          else if (event.type === "token") setNarrativeText((t) => t + event.text);
          else if (event.type === "done") setGradeStage("done");
          else if (event.type === "error") {
            setGradeStage("error");
          }
        },
      );
    } catch (e) {
      setGradeStage("error");
    }
  };

  const handleNextQuestion = async () => {
    setGradeStage("idle");
    setNarrativeText("");
    setLastAnswerText("");
    setKnowledgeScore(null);
    setResponseScore(null);
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

  // Audio recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start(100);
      setRecorderStatus("recording");
      setRecorderDuration(0);
      setRecorderError(null);
      durationIntervalRef.current = window.setInterval(() => {
        setRecorderDuration((d) => d + 1);
      }, 1000);
    } catch (e) {
      setRecorderError(e instanceof Error ? e.message : "Could not start recording");
    }
  };

  const stopRecording = async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve(null);
        return;
      }
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
        mediaRecorderRef.current!.stream.getTracks().forEach((t) => t.stop());
        setRecorderStatus("idle");
        setRecorderDuration(0);
        resolve(blob);
      };
      mediaRecorderRef.current.stop();
    });
  };

  const handleToggleRecord = async () => {
    if (recorderStatus === "recording") {
      const blob = await stopRecording();
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
      await startRecording();
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isMobile = typeof window !== "undefined" && window.innerWidth < 700;

  // Blob is active only when AI is speaking (TTS playing or grading/narrating)
  const blobActive = isPlaying || gradeStage === "speaking" || gradeStage === "scoring";

  // Always show full question text
  const getVisibleQuestionText = () => question || "";

  return (
    <div className="app-shell">
      {/* History drawer overlay */}
      {showHistory && (
        <div className="history-overlay" onClick={() => setShowHistory(false)} role="dialog" aria-modal="true" aria-label="Session history">
          <div onClick={(e) => e.stopPropagation()} className="history-drawer">
            <div className="history-header">
              <div>
                <div className="panel-eyebrow mono">Session log</div>
                <h2>Progress history</h2>
              </div>
              <button className="btn-icon" onClick={() => setShowHistory(false)} aria-label="Close history">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="history-list" role="list">
              {historyLoading && <p className="text-secondary">Loading…</p>}
              {!historyLoading && historyAttempts.length === 0 && (
                <p className="text-secondary">No attempts yet — answer a question to start your log.</p>
              )}
              {historyAttempts.map((a) => (
                <button key={a.id} className="history-row" onClick={() => {}} role="listitem">
                  <div className="history-row-scores">
                    <span className="history-row-score mono" style={{ color: (a.knowledge_score ?? 0) >= 7.5 ? "var(--signal-sage)" : (a.knowledge_score ?? 0) >= 5 ? "var(--signal-amber)" : "var(--signal-rose)" }}>
                      K: {a.knowledge_score ?? "—"}/10
                    </span>
                    <span className="history-row-score mono" style={{ color: (a.response_score ?? 0) >= 7.5 ? "var(--signal-sage)" : (a.response_score ?? 0) >= 5 ? "var(--signal-amber)" : "var(--signal-rose)" }}>
                      R: {a.response_score ?? "—"}/10
                    </span>
                    {a.score && (
                      <span className="history-row-score mono" style={{ color: a.score >= 75 ? "var(--signal-sage)" : a.score >= 50 ? "var(--signal-amber)" : "var(--signal-rose)" }}>
                        {a.score}
                      </span>
                    )}
                  </div>
                  <div className="history-row-body">
                    <div className="history-row-question">{a.question}</div>
                    <div className="history-row-meta mono">
                      {a.category.replace("_", " ")} · {a.persona.replace("_", " ")} ·{" "}
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top-left history button */}
      <button
        className="history-toggle"
        onClick={openHistory}
        aria-label="Open session history"
        title="History"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      </button>

      {/* Left edge: Persona buttons */}
      <div className={`floating-rail personas ${isMobile && showPersonaMenu ? "open" : ""}`} role="group" aria-label="Select interviewer persona">
        <div className="floating-rail-label">Choose a Persona</div>
        {personas.map((p) => (
          <button
            key={p.id}
            className={`float-btn persona ${selectedPersona === p.id ? "active" : ""}`}
            onClick={() => {
              setSelectedPersona(p.id);
              if (isMobile) setShowPersonaMenu(false);
            }}
            aria-label={p.label}
            aria-pressed={selectedPersona === p.id}
            title={p.label}
          >
            <span className="float-btn-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </span>
            <span className="float-btn-label">{p.label}</span>
          </button>
        ))}
        {isMobile && (
          <button className="float-btn-menu-toggle" onClick={() => setShowPersonaMenu(!showPersonaMenu)} aria-label="Toggle persona menu" aria-expanded={showPersonaMenu}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </button>
        )}
      </div>

      {/* Right edge: Topic buttons */}
      <div className={`floating-rail topics ${isMobile && showTopicMenu ? "open" : ""}`} role="group" aria-label="Select topic category">
        <div className="floating-rail-label">Choose a Topic</div>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`float-btn topic ${selectedCategory === c.id ? "active" : ""}`}
            onClick={() => {
              setSelectedCategory(c.id);
              if (isMobile) setShowTopicMenu(false);
            }}
            aria-label={c.label}
            aria-pressed={selectedCategory === c.id}
            title={c.label}
          >
            <span className="float-btn-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
            </span>
            <span className="float-btn-label">{c.label}</span>
          </button>
        ))}
        <button
          className={`float-btn topic ${selectedCategory === "custom" ? "active" : ""}`}
          onClick={() => {
            setSelectedCategory("custom");
            if (isMobile) setShowTopicMenu(false);
          }}
          aria-label="Custom topic"
          aria-pressed={selectedCategory === "custom"}
          title="Custom topic"
        >
          <span className="float-btn-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          </span>
          <span className="float-btn-label">Custom</span>
        </button>
        <button
          className={`float-btn topic ${selectedCategory === "surprise" ? "active" : ""}`}
          onClick={() => {
            setSelectedCategory("surprise");
            if (isMobile) setShowTopicMenu(false);
          }}
          aria-label="Surprise me"
          aria-pressed={selectedCategory === "surprise"}
          title="Surprise me"
        >
          <span className="float-btn-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          </span>
          <span className="float-btn-label">Surprise me</span>
        </button>
        {isMobile && (
          <button className="float-btn-menu-toggle" onClick={() => setShowTopicMenu(!showTopicMenu)} aria-label="Toggle topic menu" aria-expanded={showTopicMenu}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </button>
        )}
      </div>

      {/* Center: Blob + Transcript */}
      <main className="stage">
        <div className="stage-inner">
          {/* Static hero title at top */}
          <div className="hero-title">
            <h1>OSCAR</h1>
            <div className="hero-acronym">
              <span>On-the-spot Speech & Communication Analysis Reviewer</span>
            </div>
            <p className="hero-subtext">Your next-gen AI larping assistant</p>
          </div>

          {errorMessage && (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          )}

          {!hasSetup ? (
            <div className="stage-empty">
              <div className="blob-wrapper">
                <Waveform mode="idle" color="#378ADD" />
              </div>
              <p className="text-secondary">Pick a topic and an interviewer to begin.</p>
            </div>
          ) : (hasSetup && !question ? (
            <>
              <div className="stage-empty">
                <div className="blob-wrapper">
                  <Waveform mode="idle" color="#378ADD" />
                </div>
                <p className="text-secondary">Loading your first question…</p>
              </div>
            </>
          ) : (
            <>
              {/* Blob visualizer - only reacts to AI voice (blue) */}
              <div className="blob-wrapper">
                <Waveform
                  mode={blobActive ? "active" : "idle"}
                  color="#378ADD"
                  audioElement={audioRef.current}
                  simulateSpeaking={simulateSpeaking}
                />
              </div>

              {/* Start button - shows before user has started, BEFORE transcript */}
              {!hasStarted && question && gradeStage === "idle" && (
                <div className="start-overlay">
                  <button
                    className="start-btn"
                    onClick={() => {
                      setHasStarted(true);
                      fetchAndPlayTTS(question, true);
                    }}
                    aria-label="Start interview"
                  >
                    Start
                  </button>
                </div>
              )}

              {/* Live transcript */}
              <div className="transcript" ref={transcriptContainerRef} aria-live="polite" aria-atomic="false">
                {transcriptLines.map((line, idx) => (
                  <div key={idx} className={`transcript-line ${line.isUser ? "user" : "ai"}`}>
                    <span className="transcript-prefix">{line.isUser ? "You" : "OSCAR"}</span>
                    <span className="transcript-text">{line.text}</span>
                  </div>
                ))}
                {gradeStage === "speaking" && narrativeText && (
                  <div className="transcript-line ai streaming">
                    <span className="transcript-prefix">OSCAR</span>
                    <span className="transcript-text">{narrativeText}</span>
                    <span className="transcript-cursor" aria-hidden="true"></span>
                  </div>
                )}
                {/* Show current question with difficulty/type labels - revealed word by word during TTS */}
                {question && gradeStage === "idle" && hasStarted && (
                  <div className="transcript-line current-question">
                    <span className="transcript-prefix">Question</span>
                    <span className="transcript-text">{getVisibleQuestionText()}</span>

                    {/* Row: labels + TTS controls, side by side */}
                    <div className="question-footer">
                      {(questionDifficulty || questionType) && (
                        <div className="question-meta">
                          {questionDifficulty && (
                            <span className={`question-badge ${questionDifficulty.toLowerCase()}`}>
                              {questionDifficulty}
                            </span>
                          )}
                          {questionType && (
                            <span className="question-badge type">
                              {questionType.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="question-tts-controls">
                        {showPlayButton && (
                          <button
                            className="btn-icon tts-play-btn"
                            onClick={handlePlayQuestion}
                            aria-label="Play question"
                            title="Play question"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                          </button>
                        )}
                        {isPlaying && !showPlayButton && (
                          <button
                            className="btn-icon tts-replay-btn"
                            onClick={handleReplayQuestion}
                            aria-label="Replay question"
                            title="Replay question"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6"></path><path d="M1 20v-6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                          </button>
                        )}
                        <label className="tts-toggle" title={ttsEnabled ? "Disable question audio" : "Enable question audio"}>
                          <input
                            type="checkbox"
                            checked={ttsEnabled}
                            onChange={toggleTTS}
                            aria-label={ttsEnabled ? "Disable question audio" : "Enable question audio"}
                          />
                          <span className="tts-toggle-slider" aria-hidden="true"></span>
                          <span className="tts-toggle-label mono" style={{ fontSize: 11, marginLeft: 6 }}>
                            {ttsEnabled ? "TTS ON" : "TTS OFF"}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Answer input area */}
              <div className="answer-area">
                {answerMode === "record" && (
                  <div className="record-controls-row">
                    <button
                      className={`record-btn ${recorderStatus === "recording" ? "active" : ""}`}
                      onClick={handleToggleRecord}
                      disabled={isTranscribing}
                      aria-label={recorderStatus === "recording" ? "Stop recording" : "Start recording"}
                    >
                      <span className="record-btn-dot" aria-hidden="true" />
                      {recorderStatus === "recording" ? "Stop" : "Record answer"}
                    </button>
                    <span className="record-timer mono">
                      {recorderStatus === "recording"
                        ? formatDuration(recorderDuration)
                        : isTranscribing
                        ? "transcribing…"
                        : ""}
                    </span>
                    {recorderError && <span className="field-error">{recorderError}</span>}
                    {transcribeError && <span className="field-error">{transcribeError}</span>}
                    {import.meta.env.DEV && (
                      <SimulateToggle onChange={setSimulateSpeaking} />
                    )}
                  </div>
                )}

                <label className="transcript-label mono" htmlFor="answer-text">
                  {answerMode === "record" ? "Transcript (edit if needed)" : "Your answer"}
                </label>
                <textarea
                  id="answer-text"
                  className="transcript-input"
                  rows={answerMode === "record" ? 4 : 6}
                  value={transcript}
                  placeholder={
                    answerMode === "record"
                      ? "Recorded speech will appear here — you can fix any transcription errors before submitting."
                      : "Type your answer here…"
                  }
                  onChange={(e) => setTranscript(e.target.value)}
                />

                <div className="answer-footer">
                  <button
                    className="btn-icon mode-toggle"
                    onClick={() => setAnswerMode(answerMode === "record" ? "type" : "record")}
                    aria-label={answerMode === "record" ? "Switch to typing mode" : "Switch to recording mode"}
                    title={answerMode === "record" ? "Type answer" : "Speak answer"}
                  >
                    {answerMode === "record" ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="19"></line></svg>
                    )}
                  </button>
                  <button
                    className="btn-primary submit-btn"
                    onClick={() => runGrading(transcript.trim())}
                    disabled={!transcript.trim() || isTranscribing || gradeStage !== "idle" || !hasSetup}
                  >
                    Submit answer
                  </button>
                </div>
              </div>
            </>
          ))}
        </div>
      </main>

      {/* Next question / retry buttons (appear during/after grading) */}
      {(gradeStage !== "idle") && (
        <div className="grading-actions">
          {gradeStage === "error" ? (
            <button className="btn-primary" onClick={() => runGrading(lastAnswerText)}>
              Try again
            </button>
          ) : gradeStage === "done" ? (
            <button className="btn-primary" onClick={handleNextQuestion}>
              Next question
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default App;