import { Copy, Trash2, X } from "lucide-react";
import type { Sample } from "../types/sample";

type Props = {
  samples: Sample[];
  missingCount: number;
  onCopy: () => void;
  onDelete: () => void;
  onClear: () => void;
};

export function BulkSelection({
  samples,
  missingCount,
  onCopy,
  onDelete,
  onClear,
}: Props) {
  const availableCount = samples.length - missingCount;

  return (
    <div className="bulk-selection">
      <div className="bulk-selection-head">
        <div>
          <p className="bulk-selection-count">{samples.length} selected</p>
          <p className="bulk-selection-note">
            Use Shift-click for a range or Cmd/Ctrl-click to toggle files.
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X size={17} />
        </button>
      </div>

      <div className="bulk-selection-summary">
        <span>{availableCount} available</span>
        {missingCount > 0 ? <span>{missingCount} missing</span> : null}
      </div>

      <div className="bulk-selection-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onCopy}
          disabled={availableCount === 0}
        >
          <Copy size={15} />
          Copy {availableCount === 1 ? "file" : `${availableCount} files`}
        </button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          <Trash2 size={15} />
          Remove selected
        </button>
      </div>
    </div>
  );
}
