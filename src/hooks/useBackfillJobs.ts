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
  metadata: 1,
  hash: 1,
  analysis: 1,
};

// A single pathological file should not leave indexing visibly stuck forever.
// The underlying native command cannot be cancelled, but the queue can move on
// and surface the path as retryable if a call takes far longer than expected.
const SCAN_TIMEOUT_MS: Record<BackfillKind, number> = {
  metadata: 15_000,
  hash: 60_000,
  analysis: 120_000,
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
  const draining = useRef(false);
  const activeKind = useRef<BackfillKind | null>(null);
  const nextKindIndex = useRef(0);
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

  const nextQueuedKind = useCallback((): BackfillKind | null => {
    for (let i = 0; i < BACKFILL_KINDS.length; i++) {
      const index = (nextKindIndex.current + i) % BACKFILL_KINDS.length;
      const kind = BACKFILL_KINDS[index];
      if (queues.current[kind].length > 0) {
        nextKindIndex.current = (index + 1) % BACKFILL_KINDS.length;
        return kind;
      }
    }
    return null;
  }, []);

  const runScan = useCallback(
    async (kind: BackfillKind, batch: string[]): Promise<ScanOutcome> => {
      let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
      const timeout = new Promise<ScanOutcome>((resolve) => {
        timeoutId = window.setTimeout(
          () => resolve({ failed: batch }),
          SCAN_TIMEOUT_MS[kind],
        );
      });
      try {
        return await Promise.race([scanFns.current[kind](batch), timeout]);
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    },
    [],
  );

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (!cancelled.current) {
        const kind = nextQueuedKind();
        if (!kind) break;
        await gate();
        if (cancelled.current) break;
        const batch = queues.current[kind].splice(0, CHUNK_SIZES[kind]);
        activeKind.current = kind;
        let failed: string[] = [];
        try {
          ({ failed } = await runScan(kind, batch));
        } catch {
          failed = batch;
        } finally {
          activeKind.current = null;
        }
        if (failed.length) failedPaths.current[kind].push(...failed);
        const c = counts.current[kind];
        c.done += batch.length;
        c.failed += failed.length;

        if (queues.current[kind].length === 0) {
          if (c.total > 0) {
            addRecent(
              `${BACKFILL_LABELS[kind]}: ${c.done} done${
                c.failed ? ` · ${c.failed} failed` : ""
              }`,
            );
          }
          syncJob(kind, "done");
        } else {
          syncJob(kind, "running");
        }
      }
    } finally {
      activeKind.current = null;
      draining.current = false;
    }
  }, [gate, nextQueuedKind, runScan, syncJob, addRecent]);

  const enqueue = useCallback(
    (kind: BackfillKind, paths: string[]) => {
      const list = Array.from(new Set(paths.filter(Boolean)));
      if (list.length === 0) return;
      const c = counts.current[kind];
      // A fresh burst (the pass is idle) resets the visible counters; appending
      // to an in-flight pass just grows its total.
      const freshBurst =
        activeKind.current !== kind && queues.current[kind].length === 0;
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
      void drain();
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
      void drain();
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

  // Cancel in-flight work and release any pause waiters on unmount. React
  // StrictMode replays effect cleanup/setup in dev, so setup must explicitly
  // clear the cancellation flag and resume any queues left by the replay.
  useEffect(() => {
    cancelled.current = false;
    if (BACKFILL_KINDS.some((kind) => queues.current[kind].length > 0)) {
      void drain();
    }
    return () => {
      cancelled.current = true;
      const resume = waiters.current;
      waiters.current = [];
      resume.forEach((w) => w());
    };
  }, [drain]);

  // Auto-start the one-time backfill once the library has loaded.
  const samplesRef = useRef(samples);
  samplesRef.current = samples;

  const refreshAll = useCallback(() => {
    const paths = samplesRef.current.map((s) => s.file_path);
    for (const kind of BACKFILL_KINDS) enqueue(kind, paths);
  }, [enqueue]);

  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    const list = samplesRef.current;
    if (list.length === 0) return;
    started.current = true;
    enqueue(
      "metadata",
      list.filter((s) => s.duration_seconds == null).map((s) => s.file_path),
    );
    enqueue(
      "hash",
      list.filter((s) => s.hash_status !== "ok").map((s) => s.file_path),
    );
    enqueue(
      "analysis",
      list.filter((s) => s.analysis_status !== "ok").map((s) => s.file_path),
    );
  }, [ready, samples.length, enqueue]);

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
    refreshAll,
    retry,
    retryAll,
    togglePause,
  };
}
