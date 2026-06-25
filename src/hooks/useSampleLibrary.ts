import { useCallback, useEffect, useState } from "react";
import type { Sample } from "../types/sample";
import {
  getAppMeta,
  listAllTags,
  listSamples,
  setAppMeta,
  setAudioAnalysisMeta,
  setAudioMeta,
  setFileHashMeta,
  setFilePath,
} from "../db/samples";
import {
  allowAssetFiles,
  analyzeAudio,
  type AudioAnalysisResult,
  type AudioMetaResult,
  deleteLibraryFile,
  FileNotFoundError,
  findMissingPaths,
  hashFiles,
  type FileHashResult,
  importToLibrary,
  readMetadata,
  unmanagedPaths,
} from "../lib/files";
import type { ToastKind } from "../components/Toast";

type Notify = (text: string, kind?: ToastKind) => void;

/** Result of scanning a chunk of paths: which of them failed to process. */
export type ScanOutcome = { failed: string[] };

export function useSampleLibrary(notify: Notify) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missingIds, setMissingIds] = useState<Set<number>>(new Set());
  const [migrating, setMigrating] = useState(false);

  const refreshMissing = useCallback(async (list: Sample[]) => {
    const missing = await findMissingPaths(list.map((s) => s.file_path));
    setMissingIds(
      new Set(list.filter((s) => missing.has(s.file_path)).map((s) => s.id)),
    );
    return missing;
  }, []);

  const reload = useCallback(async () => {
    const [nextSamples, nextTags] = await Promise.all([
      listSamples(),
      listAllTags(),
    ]);
    await allowAssetFiles(nextSamples.map((s) => s.file_path));
    setSamples(nextSamples);
    setAllTags(nextTags);
    await refreshMissing(nextSamples);
  }, [refreshMissing]);

  // The scan functions process whatever paths they are handed (the backfill job
  // runner feeds them one chunk at a time). They persist results, fold them into
  // the in-memory samples, and return the paths that failed so the job surface
  // can show failure counts and offer a retry. Metadata has no error column, so
  // it never reports failures.
  const scanMetadata = useCallback(
    async (paths: string[]): Promise<ScanOutcome> => {
      if (paths.length === 0) return { failed: [] };
      let results: AudioMetaResult[];
      try {
        results = await readMetadata(paths);
      } catch {
        return { failed: [] };
      }
      const byPath = new Map(results.map((r) => [r.path, r]));
      for (const r of results) {
        try {
          await setAudioMeta(r.path, {
            duration_seconds: r.duration_seconds,
            sample_rate: r.sample_rate,
            channels: r.channels,
          });
        } catch {
          // Ignore persistence failure for an individual file.
        }
      }
      setSamples((prev) =>
        prev.map((s) => {
          const r = byPath.get(s.file_path);
          if (!r) return s;
          return {
            ...s,
            duration_seconds: r.duration_seconds ?? undefined,
            sample_rate: r.sample_rate ?? undefined,
            channels: r.channels ?? undefined,
          };
        }),
      );
      return { failed: [] };
    },
    [],
  );

  const scanHashes = useCallback(
    async (paths: string[]): Promise<ScanOutcome> => {
      if (paths.length === 0) return { failed: [] };
      let results: FileHashResult[];
      try {
        results = await hashFiles(paths);
      } catch {
        return { failed: paths };
      }
      const byPath = new Map(results.map((r) => [r.path, r]));
      for (const r of results) {
        try {
          await setFileHashMeta(r.path, {
            file_size: r.file_size,
            content_hash: r.content_hash,
            hash_status: r.status,
            hash_error: r.error,
          });
        } catch {
          // Ignore persistence failure for an individual file.
        }
      }
      setSamples((prev) =>
        prev.map((s) => {
          const r = byPath.get(s.file_path);
          if (!r) return s;
          return {
            ...s,
            file_size: r.file_size ?? undefined,
            content_hash: r.content_hash ?? undefined,
            hash_status: r.status,
            hash_error: r.error ?? undefined,
          };
        }),
      );
      return {
        failed: results.filter((r) => r.status === "error").map((r) => r.path),
      };
    },
    [],
  );

  const scanAnalysis = useCallback(
    async (paths: string[]): Promise<ScanOutcome> => {
      if (paths.length === 0) return { failed: [] };
      let results: AudioAnalysisResult[];
      try {
        results = await analyzeAudio(paths);
      } catch {
        return { failed: paths };
      }
      const byPath = new Map(results.map((r) => [r.path, r]));
      for (const r of results) {
        try {
          await setAudioAnalysisMeta(r.path, {
            detected_bpm: r.detected_bpm,
            detected_bpm_confidence: r.detected_bpm_confidence,
            detected_key: r.detected_key,
            detected_key_confidence: r.detected_key_confidence,
            audio_fingerprint: r.audio_fingerprint,
            fingerprint_version: r.fingerprint_version,
            analysis_status: r.status,
            analysis_error: r.error,
          });
        } catch {
          // Ignore persistence failure for an individual file.
        }
      }
      setSamples((prev) =>
        prev.map((s) => {
          const r = byPath.get(s.file_path);
          if (!r) return s;
          return {
            ...s,
            detected_bpm: r.detected_bpm ?? undefined,
            detected_bpm_confidence: r.detected_bpm_confidence ?? undefined,
            detected_key: r.detected_key ?? undefined,
            detected_key_confidence: r.detected_key_confidence ?? undefined,
            audio_fingerprint: r.audio_fingerprint ?? undefined,
            fingerprint_version: r.fingerprint_version ?? undefined,
            analysis_status: r.status,
            analysis_error: r.error ?? undefined,
          };
        }),
      );
      return {
        failed: results.filter((r) => r.status === "error").map((r) => r.path),
      };
    },
    [],
  );

  const handleRescan = useCallback(async () => {
    try {
      const missing = await refreshMissing(samples);
      notify(
        missing.size
          ? `${missing.size} file${missing.size === 1 ? "" : "s"} missing`
          : "All files found",
        missing.size ? "error" : "success",
      );
    } catch (err) {
      notify(`Could not rescan files: ${err}`, "error");
    }
  }, [refreshMissing, samples, notify]);

  const runLibraryMigration = useCallback(async () => {
    if (await getAppMeta("library_migrated")) return;
    const list = await listSamples();
    const external = await unmanagedPaths(list.map((s) => s.file_path));
    if (external.size === 0) {
      await setAppMeta("library_migrated", "1");
      return;
    }

    setMigrating(true);
    let moved = 0;
    let missing = 0;
    let failed = 0;
    try {
      for (const s of list) {
        if (!external.has(s.file_path)) continue;
        let managedPath: string | null = null;
        try {
          managedPath = await importToLibrary(s.file_path, s.type ?? "");
          await setFilePath(s.id, managedPath);
          moved++;
        } catch (err) {
          if (managedPath) {
            await deleteLibraryFile(managedPath).catch(() => {});
          }
          if (err instanceof FileNotFoundError) {
            missing++;
          } else {
            failed++;
          }
        }
      }
      if (failed === 0) await setAppMeta("library_migrated", "1");
    } finally {
      setMigrating(false);
    }

    await reload();
    if (moved || missing || failed) {
      const parts = [
        `${moved} file${moved === 1 ? "" : "s"} added to your library`,
      ];
      if (missing) parts.push(`${missing} missing and skipped`);
      if (failed) parts.push(`${failed} will retry next launch`);
      notify(parts.join(" · "), missing || failed ? "info" : "success");
    }
  }, [notify, reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
        if (!cancelled) await runLibraryMigration();
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, runLibraryMigration]);

  // Backfill of missing metadata/hash/analysis is now owned by useBackfillJobs,
  // which runs the scan functions in observable, pausable chunks.

  return {
    samples,
    setSamples,
    allTags,
    loading,
    loadError,
    missingIds,
    migrating,
    reload,
    scanMetadata,
    scanHashes,
    scanAnalysis,
    handleRescan,
  };
}
