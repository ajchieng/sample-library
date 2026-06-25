import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Sample } from "../types/sample";
import type { ScanOutcome } from "./useSampleLibrary";

/** The three background indexing passes the app runs over the library. */
export const BACKFILL_KINDS = ["metadata", "hash", "analysis"] as const;
export type BackfillKind = (typeof BACKFILL_KINDS)[number];

export const BACKFILL_LABELS: Record<BackfillKind, string> = {
  metadata: "Metadata",
  hash: "Hashes",
  analysis: "Analysis",
};

export type BackfillStatus = "idle" | "running" | "done";

export type BackfillJob = {
  kind: BackfillKind;
  total: number;
  done: number;
  failed: number;
  status: BackfillStatus;
};

export type RecentEvent = { id: number; label: string };

// Per-pass batch sizes. Smaller for analysis since decoding audio is the most
// expensive pass, so progress stays responsive and pause reacts quickly.
const CHUNK_SIZES: Record<BackfillKind, number> = {
  metadata: 50,
  hash: 25,
  analysis: 8,
};

type ScanFn = (paths: string[]) => Promise<ScanOutcome>;
type Counts = { total: number; done: number; failed: number };

type UseBackfillJobsOptions = {
  scanMetadata: ScanFn;
  scanHashes: ScanFn;
  scanAnalysis: ScanFn;
  /** Current library, read once when the initial backfill kicks off. */
  samples: Sample[];
  /** True once the initial library load finished — gates the auto-start. */
  ready: boolean;
};

function emptyByKind<T>(make: () => T): Record<BackfillKind, T> {
  return {
    metadata: make(),
    hash: make(),
    analysis: make(),
  };
}

function initialJobs(): Record<BackfillKind, BackfillJob> {
  return {
    metadata: {
      kind: "metadata",
      total: 0,
      done: 0,
      failed: 0,
      status: "idle",
    },
    hash: { kind: "hash", total: 0, done: 0, failed: 0, status: "idle" },
    analysis: {
      kind: "analysis",
      total: 0,
      done: 0,
      failed: 0,
      status: "idle",
    },
  };
}

export function useBackfillJobs({
  scanMetadata,
  scanHashes,
  scanAnalysis,
  samples,
  ready,
}: UseBackfillJobsOptions) {
  const [jobs, setJobs] = useState(initialJobs);
  const [paused, setPaused] = useState(false);
  const [recent, setRecent] = useState<RecentEvent[]>([]);

  // The mutable truth lives in refs (updated synchronously inside the drain
  // loop); React state mirrors it for rendering.
  const counts = useRef(
    emptyByKind<Counts>(() => ({ total: 0, done: 0, failed: 0 })),
  );
  const queues = useRef(emptyByKind<string[]>(() => []));
  const draining = useRef(emptyByKind<boolean>(() => false));
  const failedPaths = useRef(emptyByKind<string[]>(() => []));

  const pausedRef = useRef(false);
  const waiters = useRef<(() => void)[]>([]);
  const cancelled = useRef(false);
  const recentId = useRef(0);

  // Always call the latest scan functions without re-creating the drain loop.
  const scanFns = useRef<Record<BackfillKind, ScanFn>>({
    metadata: scanMetadata,
    hash: scanHashes,
    analysis: scanAnalysis,
  });
  scanFns.current = {
    metadata: scanMetadata,
    hash: scanHashes,
    analysis: scanAnalysis,
  };

  const syncJob = useCallback((kind: BackfillKind, status: BackfillStatus) => {
    const c = counts.current[kind];
    setJobs((prev) => ({
      ...prev,
      [kind]: {
        kind,
        total: c.total,
        done: c.done,
        failed: c.failed,
        status,
      },
    }));
  }, []);

  const addRecent = useCallback((label: string) => {
    recentId.current += 1;
    const id = recentId.current;
    setRecent((prev) => [{ id, label }, ...prev].slice(0, 5));
  }, []);

  // Resolves immediately unless paused; otherwise waits until resume/unmount.
  const gate = useCallback(async () => {
    if (!pausedRef.current) return;
    await new Promise<void>((resolve) => {
      waiters.current.push(resolve);
    });
  }, []);

  const drain = useCallback(
    async (kind: BackfillKind) => {
      if (draining.current[kind]) return;
      draining.current[kind] = true;
      try {
        while (queues.current[kind].length > 0 && !cancelled.current) {
          await gate();
          if (cancelled.current) break;
          const batch = queues.current[kind].splice(0, CHUNK_SIZES[kind]);
          let failed: string[] = [];
          try {
            ({ failed } = await scanFns.current[kind](batch));
          } catch {
            failed = batch;
          }
          if (failed.length) failedPaths.current[kind].push(...failed);
          const c = counts.current[kind];
          c.done += batch.length;
          c.failed += failed.length;
          syncJob(kind, "running");
        }
      } finally {
        draining.current[kind] = false;
      }

      if (!cancelled.current && queues.current[kind].length === 0) {
        const c = counts.current[kind];
        if (c.total > 0) {
          addRecent(
            `${BACKFILL_LABELS[kind]}: ${c.done} done${
              c.failed ? ` · ${c.failed} failed` : ""
            }`,
          );
        }
        syncJob(kind, "done");
      }
    },
    [gate, syncJob, addRecent],
  );

  const enqueue = useCallback(
    (kind: BackfillKind, paths: string[]) => {
      const list = paths.filter(Boolean);
      if (list.length === 0) return;
      const c = counts.current[kind];
      // A fresh burst (the pass is idle) resets the visible counters; appending
      // to an in-flight pass just grows its total.
      const freshBurst =
        !draining.current[kind] && queues.current[kind].length === 0;
      if (freshBurst) {
        c.total = list.length;
        c.done = 0;
        c.failed = 0;
        failedPaths.current[kind] = [];
      } else {
        c.total += list.length;
      }
      queues.current[kind].push(...list);
      syncJob(kind, "running");
      void drain(kind);
    },
    [drain, syncJob],
  );

  const retry = useCallback(
    (kind: BackfillKind) => {
      const failed = failedPaths.current[kind];
      if (failed.length === 0) return;
      failedPaths.current[kind] = [];
      const c = counts.current[kind];
      // Re-run the failed items without double-counting: undo their done/failed
      // contribution, then push them back through the queue.
      c.done = Math.max(0, c.done - failed.length);
      c.failed = Math.max(0, c.failed - failed.length);
      queues.current[kind].push(...failed);
      syncJob(kind, "running");
      void drain(kind);
    },
    [drain, syncJob],
  );

  const retryAll = useCallback(() => {
    for (const kind of BACKFILL_KINDS) retry(kind);
  }, [retry]);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (!next) {
      const resume = waiters.current;
      waiters.current = [];
      resume.forEach((w) => w());
    }
  }, []);

  // Cancel in-flight work and release any pause waiters on unmount.
  useEffect(
    () => () => {
      cancelled.current = true;
      const resume = waiters.current;
      waiters.current = [];
      resume.forEach((w) => w());
    },
    [],
  );

  // Auto-start the one-time backfill once the library has loaded.
  const samplesRef = useRef(samples);
  samplesRef.current = samples;
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const list = samplesRef.current;
    enqueue(
      "metadata",
      list.filter((s) => s.duration_seconds == null).map((s) => s.file_path),
    );
    enqueue(
      "hash",
      list.filter((s) => s.hash_status == null).map((s) => s.file_path),
    );
    enqueue(
      "analysis",
      list.filter((s) => s.analysis_status == null).map((s) => s.file_path),
    );
  }, [ready, enqueue]);

  const { busy, aggregateDone, aggregateTotal, totalFailed } = useMemo(() => {
    let done = 0;
    let total = 0;
    let failedSum = 0;
    let running = 0;
    for (const kind of BACKFILL_KINDS) {
      const job = jobs[kind];
      failedSum += job.failed;
      if (job.status === "running") {
        running += 1;
        done += job.done;
        total += job.total;
      }
    }
    return {
      busy: running > 0,
      aggregateDone: done,
      aggregateTotal: total,
      totalFailed: failedSum,
    };
  }, [jobs]);

  return {
    jobs,
    recent,
    paused,
    busy,
    aggregateDone,
    aggregateTotal,
    totalFailed,
    enqueue,
    retry,
    retryAll,
    togglePause,
  };
}
