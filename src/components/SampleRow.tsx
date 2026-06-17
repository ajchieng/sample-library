import { useEffect, useRef } from "react";
import clsx from "clsx";
import { AlertTriangle, Music2 } from "lucide-react";
import type { Sample } from "../types/sample";

type Props = {
  sample: Sample;
  selected: boolean;
  missing: boolean;
  onSelect: (id: number) => void;
};

export function SampleRow({ sample, selected, missing, onSelect }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Keep the selected row visible when navigating with the keyboard. `nearest`
  // is a no-op when the row is already fully on screen, so mouse clicks don't
  // cause the list to jump.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div
      ref={rowRef}
      className={clsx("sample-row", { selected, missing })}
      onClick={() => onSelect(sample.id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect(sample.id);
      }}
    >
      <div className="col-name">
        {missing ? (
          <AlertTriangle
            size={15}
            className="row-icon-missing"
            aria-label="File missing"
          />
        ) : (
          <Music2 size={15} className="row-icon" />
        )}
        <span
          className={clsx("row-name", { "row-name-missing": missing })}
          title={missing ? `${sample.name} — file missing` : sample.name}
        >
          {sample.name}
        </span>
      </div>

      <div className="col-type">
        {sample.type ? (
          <span className="type-cell">
            <span className={`type-dot type-dot-${sample.type}`} />
            {sample.type}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <div className="col-bpm">
        {sample.bpm != null ? sample.bpm : <span className="muted">—</span>}
      </div>

      <div className="col-key">
        {sample.musical_key ? (
          sample.musical_key
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <div className="col-tags">
        {sample.tags.length > 0 ? (
          sample.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="chip chip-sm">
              {tag}
            </span>
          ))
        ) : (
          <span className="muted">—</span>
        )}
        {sample.tags.length > 4 ? (
          <span className="chip chip-sm chip-more">
            +{sample.tags.length - 4}
          </span>
        ) : null}
      </div>
    </div>
  );
}
