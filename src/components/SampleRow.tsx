import { useEffect, useRef, useState, type DragEvent } from "react";
import clsx from "clsx";
import { AlertTriangle, GripVertical, Music2, Star } from "lucide-react";
import type { Sample } from "../types/sample";
import { startSampleDrag } from "../lib/dragExport";

type Props = {
  sample: Sample;
  selected: boolean;
  missing: boolean;
  onSelect: (id: number) => void;
  onToggleFavorite: (id: number, value: boolean) => void;
};

export function SampleRow({
  sample,
  selected,
  missing,
  onSelect,
  onToggleFavorite,
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Keep the selected row visible when navigating with the keyboard. `nearest`
  // is a no-op when the row is already fully on screen, so mouse clicks don't
  // cause the list to jump.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (missing || (event.target as HTMLElement).closest("button")) {
      event.preventDefault();
      return;
    }
    // Hand off to a native OS drag: the webview's HTML5 drag isn't recognized as
    // a file by native apps, so DAWs/Finder receive nothing. preventDefault stops
    // the HTML5 drag so the native session (which drops a real *copy*) takes over.
    event.preventDefault();
    setDragging(true);
    void startSampleDrag(sample.file_path, () => setDragging(false));
  };

  return (
    <div
      ref={rowRef}
      className={clsx("sample-row", { selected, missing, dragging })}
      onClick={() => onSelect(sample.id)}
      role="row"
      aria-selected={selected}
      draggable={!missing}
      title={
        missing
          ? "Relink this missing file before dragging it out"
          : "Drag this sample to Finder, your DAW, or another app"
      }
      onDragStart={handleDragStart}
      onDragEnd={() => setDragging(false)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect(sample.id);
      }}
    >
      <div className="col-name" role="gridcell">
        <GripVertical
          size={14}
          className="drag-grip"
          aria-hidden="true"
        />
        <button
          type="button"
          className={clsx("star-btn", { active: sample.is_favorite })}
          aria-pressed={sample.is_favorite}
          aria-label={sample.is_favorite ? "Remove from favorites" : "Add to favorites"}
          title={sample.is_favorite ? "Remove from favorites" : "Add to favorites"}
          // Stop propagation so toggling a favorite never selects the row or
          // trips the editor's unsaved-changes confirm.
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(sample.id, !sample.is_favorite);
          }}
        >
          <Star size={15} fill={sample.is_favorite ? "currentColor" : "none"} />
        </button>
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

      <div className="col-type" role="gridcell">
        {sample.type ? (
          <span className="type-cell">
            <span className={`type-dot type-dot-${sample.type}`} />
            {sample.type}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <div className="col-bpm" role="gridcell">
        {sample.bpm != null ? sample.bpm : <span className="muted">—</span>}
      </div>

      <div className="col-key" role="gridcell">
        {sample.musical_key ? (
          sample.musical_key
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <div className="col-tags" role="gridcell">
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
