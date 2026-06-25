import { useEffect, useRef } from "react";
import { Pause, Play, RefreshCw, RotateCcw, X } from "lucide-react";
import {
  BACKFILL_KINDS,
  BACKFILL_LABELS,
  type BackfillJob,
  type BackfillKind,
  type RecentEvent,
} from "../hooks/useBackfillJobs";

type Props = {
  jobs: Record<BackfillKind, BackfillJob>;
  recent: RecentEvent[];
  paused: boolean;
  totalFailed: number;
  onTogglePause: () => void;
  onRefreshAll: () => void;
  onRetry: (kind: BackfillKind) => void;
  onRetryAll: () => void;
  onClose: () => void;
};

function statusLabel(job: BackfillJob, paused: boolean): string {
  if (job.status === "idle") return "Idle";
  if (job.status === "done") return "Done";
  return paused ? "Paused" : "Running";
}

export function ActivityPanel({
  jobs,
  recent,
  paused,
  totalFailed,
  onTogglePause,
  onRefreshAll,
  onRetry,
  onRetryAll,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const anyRunning = BACKFILL_KINDS.some((k) => jobs[k].status === "running");

  return (
    <div className="help-backdrop" role="presentation" onClick={onClose}>
      {/* The dialog needs onKeyDown to trap Tab focus and onClick to stop a
          backdrop-closing click; these are standard modal-dialog interactions. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <section
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable?.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="help-panel-head">
          <div>
            <h2 id="activity-title">Activity</h2>
            <p>
              Background indexing reads metadata, hashes files for duplicate
              detection, and analyzes BPM/key. Your files are never modified.
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="icon-btn"
            onClick={onClose}
            aria-label="Close activity"
          >
            <X size={17} />
          </button>
        </header>

        <div className="job-list">
          {BACKFILL_KINDS.map((kind) => {
            const job = jobs[kind];
            const pct =
              job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
            return (
              <div className="job-row" key={kind}>
                <div className="job-head">
                  <span className="job-name">{BACKFILL_LABELS[kind]}</span>
                  <span className="job-count">
                    {job.done.toLocaleString()}/{job.total.toLocaleString()}
                    <span className="job-status">
                      {" "}
                      · {statusLabel(job, paused)}
                    </span>
                  </span>
                </div>
                <div
                  className="job-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={job.total}
                  aria-valuenow={job.done}
                  aria-label={`${BACKFILL_LABELS[kind]} progress`}
                >
                  <div
                    className="job-fill"
                    style={{ width: `${pct}%` }}
                    data-done={job.status === "done"}
                  />
                </div>
                {job.failed > 0 ? (
                  <div className="job-failed">
                    <span>
                      {job.failed.toLocaleString()} failed
                      {kind === "metadata" ? " to read" : ""}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onRetry(kind)}
                    >
                      <RotateCcw size={13} />
                      Retry
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="job-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onTogglePause}
            disabled={!anyRunning && !paused}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onRefreshAll}
          >
            <RefreshCw size={15} />
            Refresh all
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onRetryAll}
            disabled={totalFailed === 0}
          >
            <RefreshCw size={15} />
            Retry all failed
          </button>
        </div>

        {recent.length > 0 ? (
          <div className="job-recent">
            <span className="job-recent-title">Recent</span>
            <ul>
              {recent.map((event) => (
                <li key={event.id}>{event.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
