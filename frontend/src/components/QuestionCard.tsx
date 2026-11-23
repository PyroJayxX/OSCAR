interface QuestionCardProps {
  categoryLabel: string;
  question: string;
  loading: boolean;
  onNewFromBank: () => void;
  onGenerate: () => void;
}

export function QuestionCard({
  categoryLabel,
  question,
  loading,
  onNewFromBank,
  onGenerate,
}: QuestionCardProps) {
  return (
    <div className="panel question-card">
      <div className="panel-eyebrow mono">{categoryLabel} — question</div>
      <p className="question-text">{loading ? "Tuning in…" : question}</p>
      <div className="question-actions">
        <button className="btn-ghost" onClick={onNewFromBank} disabled={loading}>
          Swap question
        </button>
        <button className="btn-ghost" onClick={onGenerate} disabled={loading}>
          Generate with AI
        </button>
      </div>
    </div>
  );
}
