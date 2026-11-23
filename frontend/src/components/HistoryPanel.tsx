import { useState } from "react";
import { api, type AttemptDetail, type AttemptSummary } from "../api/client";

interface HistoryPanelProps {
  attempts: AttemptSummary[];
  loading: boolean;
  onClose: () => void;
}

function scoreColor(score: number): string {
  if (score >= 75) return "var(--signal-sage)";
  if (score >= 50) return "var(--signal-amber)";
  return "var(--signal-rose)";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function HistoryPanel({ attempts, loading, onClose }: HistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, AttemptDetail>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const avg =
    attempts.length > 0
      ? Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length)
      : null;

  const toggleRow = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (details[id]) return;
    setDetailLoading(id);
    setDetailError(null);
    try {
      const detail = await api.getHistoryDetail(id);
      setDetails((prev) => ({ ...prev, [id]: detail }));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Could not load this attempt");
    } finally {
      setDetailLoading(null);
    }
  };

  return (
    <div className="panel history-panel">
      <div className="history-header">
        <div>
          <div className="panel-eyebrow mono">Session log</div>
          <h2>Progress history</h2>
        </div>
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {avg !== null && (
        <div className="history-avg mono">
          {attempts.length} attempt{attempts.length === 1 ? "" : "s"} · avg score {avg}
        </div>
      )}

      {loading && <p className="text-secondary">Loading…</p>}
      {!loading && attempts.length === 0 && (
        <p className="text-secondary">No attempts yet — answer a question to start your log.</p>
      )}

      <div className="history-list">
        {attempts.map((a) => {
          const isExpanded = expandedId === a.id;
          const detail = details[a.id];
          return (
            <div key={a.id} className="history-entry">
              <button
                className="history-row"
                onClick={() => toggleRow(a.id)}
                aria-expanded={isExpanded}
              >
                <div className="history-row-score mono" style={{ color: scoreColor(a.score) }}>
                  {a.score}
                </div>
                <div className="history-row-body">
                  <div className="history-row-question">{a.question}</div>
                  <div className="history-row-meta mono">
                    {a.category.replace("_", " ")} · {a.persona.replace("_", " ")} ·{" "}
                    {formatDate(a.created_at)}
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="history-detail">
                  {detailLoading === a.id && <p className="text-secondary">Loading…</p>}
                  {detailError && detailLoading !== a.id && !detail && (
                    <p className="field-error">{detailError}</p>
                  )}
                  {detail && (
                    <>
                      <div className="history-detail-block">
                        <div className="panel-eyebrow mono">Your answer</div>
                        <p>{detail.answer_text}</p>
                      </div>
                      <div className="history-detail-block">
                        <div className="panel-eyebrow mono">Feedback</div>
                        <p>{detail.feedback}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
