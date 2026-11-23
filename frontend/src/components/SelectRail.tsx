interface RailItem {
  id: string;
  label: string;
  description?: string;
}

interface SelectRailProps {
  title: string;
  items: RailItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SelectRail({ title, items, selectedId, onSelect }: SelectRailProps) {
  return (
    <div className="rail-group">
      <div className="rail-group-title mono">{title}</div>
      <div className="rail-items">
        {items.map((item) => (
          <button
            key={item.id}
            className={`rail-item ${selectedId === item.id ? "rail-item--active" : ""}`}
            onClick={() => onSelect(item.id)}
            aria-pressed={selectedId === item.id}
          >
            <span className="rail-item-indicator" aria-hidden="true" />
            <span className="rail-item-text">
              <span className="rail-item-label">{item.label}</span>
              {item.description && (
                <span className="rail-item-desc">{item.description}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
