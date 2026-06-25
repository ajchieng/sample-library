import clsx from "clsx";
import { AlertTriangle, Loader2, Pause } from "lucide-react";

type Props = {
  busy: boolean;
  paused: boolean;
  aggregateDone: number;
  aggregateTotal: number;
  totalFailed: number;
  onClick: () => void;
};

/**
 * Compact header indicator for background indexing. Visible only when there is
 * something worth reporting (work in flight, paused, or failures to retry);
 * clicking opens the Activity panel.
 */
export function ActivityChip({
  busy,
  paused,
  aggregateDone,
  aggregateTotal,
  totalFailed,
  onClick,
}: Props) {
  const active = busy || paused;
  if (!active && totalFailed === 0) return null;

  let label: string;
  if (active && aggregateTotal > 0) {
    label = `${paused ? "Paused" : "Indexing"} ${aggregateDone.toLocaleString()}/${aggregateTotal.toLocaleString()}`;
  } else if (active) {
    label = paused ? "Paused" : "Indexing…";
  } else {
    label = `${totalFailed.toLocaleString()} failed`;
  }

  const tone = !active && totalFailed > 0 ? "error" : "busy";

  return (
    <button
      type="button"
      className={clsx("activity-chip", tone)}
      onClick={onClick}
      title="Show background indexing activity"
    >
      {paused ? (
        <Pause size={14} />
      ) : tone === "error" ? (
        <AlertTriangle size={14} />
      ) : (
        <Loader2 size={14} className="spin" />
      )}
      <span>{label}</span>
      {active && totalFailed > 0 ? (
        <span className="activity-chip-failed">{totalFailed}</span>
      ) : null}
    </button>
  );
}
