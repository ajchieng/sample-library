import type { ScanProgress as Progress } from "../hooks/useFolderScan";

type Props = {
  progress: Progress | null;
};

export function ScanProgress({ progress }: Props) {
  if (!progress) return null;
  const { done, total } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="scan-progress" role="status" aria-live="polite">
      <span className="scan-progress-text">
        {total > 0 ? `Importing ${done} of ${total}…` : "Scanning folder…"}
      </span>
      <div
        className="scan-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className="scan-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
