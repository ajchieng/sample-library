import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { HelpCircle } from "lucide-react";

import type { Sample, SampleMetadata } from "./types/sample";
import {
  createSample,
  deleteSample,
  DuplicateSampleError,
  getAppMeta,
  listAllTags,
  listSamples,
  relinkSample,
  setAppMeta,
  setAudioAnalysisMeta,
  setAudioMeta,
  setFavorite,
  setFileHashMeta,
  setFilePath,
  setSampleTags,
  updateSample,
} from "./db/samples";
import {
  allowAssetFiles,
  analyzeAudio,
  type AudioAnalysisResult,
  type AudioMetaResult,
  basename,
  copyFilesToClipboard,
  deleteLibraryFile,
  filenameWithoutExt,
  FileNotFoundError,
  findMissingPaths,
  hashFiles,
  type FileHashResult,
  importToLibrary,
  parentFolderName,
  readMetadata,
  refileInLibrary,
  revealInFinder,
  SUPPORTED_EXTENSIONS,
  unmanagedPaths,
} from "./lib/files";
import { FILE_MISSING_MESSAGE } from "./lib/audio";
import { supportedDroppedPaths } from "./lib/dragDrop";
import { isExportInProgress } from "./lib/dragExport";
import {
  exactDuplicateGroups,
  groupSizeForSample,
  nearDuplicateGroups,
} from "./lib/analysis";
import { deriveFilterOptions, filterSamples } from "./lib/sampleView";

import { SearchBar } from "./components/SearchBar";
import { AddSampleButton } from "./components/AddSampleButton";
import { FilterBar, EMPTY_FILTERS, type Filters } from "./components/FilterBar";
import { SampleList } from "./components/SampleList";
import { SampleEditor } from "./components/SampleEditor";
import { AudioPlayer } from "./components/AudioPlayer";
import { Toast, type ToastKind, type ToastMessage } from "./components/Toast";
import { KeyboardHelp } from "./components/KeyboardHelp";

export default function App() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  // IDs of samples whose file is no longer on disk (derived, not persisted).
  const [missingIds, setMissingIds] = useState<Set<number>>(new Set());

  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  // True while the one-time migration is copying existing files into the
  // managed library, so the loading screen can show a tailored message.
  const [migrating, setMigrating] = useState(false);

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  // Whether the open editor has unsaved edits. A ref (not state) because only
  // the navigation handlers read it, at the moment of navigating.
  const editorDirty = useRef(false);

  const notify = useCallback((text: string, kind: ToastKind = "info") => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  /** Re-derive which of the given samples have a missing file on disk. */
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
    // Grant asset-protocol access to the library's files before they can be
    // selected/played (the configured scope is empty by default).
    await allowAssetFiles(nextSamples.map((s) => s.file_path));
    setSamples(nextSamples);
    setAllTags(nextTags);
    await refreshMissing(nextSamples);
  }, [refreshMissing]);

  // Read + cache audio metadata (duration/sample-rate/channels) for the given
  // paths, persist it, and merge it into state. Best-effort: any failure is
  // ignored and the fields simply stay unknown.
  const scanMetadata = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    let results: AudioMetaResult[];
    try {
      results = await readMetadata(paths);
    } catch {
      return;
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
  }, []);

  const scanHashes = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    let results: FileHashResult[];
    try {
      results = await hashFiles(paths);
    } catch {
      return;
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
  }, []);

  const scanAnalysis = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    let results: AudioAnalysisResult[];
    try {
      results = await analyzeAudio(paths);
    } catch {
      return;
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
  }, []);

  const handleRescan = useCallback(async () => {
    const missing = await refreshMissing(samples);
    notify(
      missing.size
        ? `${missing.size} file${missing.size === 1 ? "" : "s"} missing`
        : "All files found",
      missing.size ? "error" : "success",
    );
  }, [refreshMissing, samples, notify]);

  // One-time migration: copy every externally-referenced file into the managed
  // library (organized by type). Guarded by an app_meta flag so it runs once,
  // and skips files already inside the library so it's safe to resume after an
  // interrupted run. Missing files are left external and reported.
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
    let skipped = 0;
    try {
      for (const s of list) {
        if (!external.has(s.file_path)) continue; // already managed
        try {
          const managedPath = await importToLibrary(s.file_path, s.type ?? "");
          await setFilePath(s.id, managedPath);
          moved++;
        } catch {
          // Missing on disk or copy failed — leave it external; the normal
          // missing-file scan still surfaces it.
          skipped++;
        }
      }
      await setAppMeta("library_migrated", "1");
    } finally {
      setMigrating(false);
    }

    await reload();
    if (moved || skipped) {
      const parts = [`${moved} file${moved === 1 ? "" : "s"} added to your library`];
      if (skipped) parts.push(`${skipped} missing and skipped`);
      notify(parts.join(" · "), skipped ? "info" : "success");
    }
  }, [notify, reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
        // Run the one-time migration inside the load phase so the metadata
        // backfills below (gated on `loading`) don't race with file_path
        // changes — they only fire once setup is done and state is fresh.
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

  // Don't strand the "only missing" filter once nothing is missing anymore
  // (the toggle that turns it off is hidden when the count hits zero).
  useEffect(() => {
    if (onlyMissing && missingIds.size === 0) setOnlyMissing(false);
  }, [onlyMissing, missingIds]);

  // One-time backfill: populate audio metadata for samples imported before this
  // feature existed (those still missing a duration). Runs once after first load.
  const metadataBackfilled = useRef(false);
  useEffect(() => {
    if (metadataBackfilled.current || loading || samples.length === 0) return;
    metadataBackfilled.current = true;
    const missing = samples
      .filter((s) => s.duration_seconds == null)
      .map((s) => s.file_path);
    void scanMetadata(missing);
  }, [loading, samples, scanMetadata]);

  const hashBackfilled = useRef(false);
  useEffect(() => {
    if (hashBackfilled.current || loading || samples.length === 0) return;
    hashBackfilled.current = true;
    const missing = samples
      .filter((s) => s.hash_status == null)
      .map((s) => s.file_path);
    void scanHashes(missing);
  }, [loading, samples, scanHashes]);

  const analysisBackfilled = useRef(false);
  useEffect(() => {
    if (analysisBackfilled.current || loading || samples.length === 0) return;
    analysisBackfilled.current = true;
    const missing = samples
      .filter((s) => s.analysis_status == null)
      .map((s) => s.file_path);
    void scanAnalysis(missing);
  }, [loading, samples, scanAnalysis]);

  // ---- Derived filter option lists -----------------------------------------
  const { keys, moods } = useMemo(() => deriveFilterOptions(samples), [samples]);

  // ---- Search + filtering ---------------------------------------------------
  const visible = useMemo(
    () =>
      filterSamples(samples, {
        search,
        filters,
        onlyMissing,
        onlyFavorites,
        missingIds,
      }),
    [samples, search, filters, onlyMissing, onlyFavorites, missingIds],
  );

  const selected = useMemo(
    () => samples.find((s) => s.id === selectedId) ?? null,
    [samples, selectedId],
  );

  const exactGroups = useMemo(() => exactDuplicateGroups(samples), [samples]);
  const nearGroups = useMemo(() => nearDuplicateGroups(samples), [samples]);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    editorDirty.current = dirty;
  }, []);

  // Switch the selected sample, but confirm first if the editor has unsaved
  // edits — otherwise arrow-key nav or a row click silently discards them.
  const requestSelect = useCallback(
    (id: number | null) => {
      if (id === selectedId) return;
      if (
        editorDirty.current &&
        !window.confirm("Discard unsaved changes to this sample?")
      ) {
        return;
      }
      editorDirty.current = false;
      setSelectedId(id);
    },
    [selectedId],
  );

  // Copy the selected sample's file onto the system clipboard (⌘C / the editor's
  // Copy button). The original file is never touched — only a file reference is
  // placed on the clipboard so it can be pasted into Finder, a DAW, etc.
  const handleCopy = useCallback(
    async (filePath: string) => {
      try {
        await copyFilesToClipboard([filePath]);
        notify("File copied to clipboard", "success");
      } catch (err) {
        notify(`Could not copy file: ${err}`, "error");
      }
    },
    [notify],
  );

  // ---- Keyboard navigation --------------------------------------------------
  // Up/Down (and Home/End) move the selection through the visible list, loading
  // each sample into the editor and player. Spacebar (handled in AudioPlayer)
  // then auditions it. Ignored while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && helpOpen) {
        e.preventDefault();
        setHelpOpen(false);
        return;
      }

      if (e.key === "?" && !helpOpen) {
        const t = e.target as HTMLElement | null;
        if (
          !t ||
          (t.tagName !== "INPUT" &&
            t.tagName !== "TEXTAREA" &&
            t.tagName !== "SELECT" &&
            !t.isContentEditable)
        ) {
          e.preventDefault();
          setHelpOpen(true);
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {
        const t = e.target as HTMLElement | null;
        const typing =
          !!t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT" ||
            t.isContentEditable);
        // Don't hijack a normal text copy: a focused field or an active text
        // selection should still copy text, not the sample's file.
        if (typing || window.getSelection()?.toString()) return;
        if (!selected || missingIds.has(selected.id)) return;
        e.preventDefault();
        void handleCopy(selected.file_path);
        return;
      }

      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (visible.length === 0) return;
      e.preventDefault();

      const idx = visible.findIndex((s) => s.id === selectedId);
      let next: number;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = visible.length - 1;
      else if (idx < 0) next = e.key === "ArrowUp" ? visible.length - 1 : 0;
      else if (e.key === "ArrowDown") next = Math.min(visible.length - 1, idx + 1);
      else next = Math.max(0, idx - 1);

      requestSelect(visible[next].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, selectedId, requestSelect, helpOpen, selected, missingIds, handleCopy]);

  const importPaths = useCallback(
    async (paths: string[], label = "Import") => {
      const supportedPaths = supportedDroppedPaths(paths);
      const bad = paths.length - supportedPaths.length;
      // Skip files that already live in the managed library — e.g. a sample
      // dragged out of the app and dropped back onto it. Re-importing them would
      // copy the managed file again and create a duplicate, so ignore them.
      const external = await unmanagedPaths(supportedPaths);
      const importable = supportedPaths.filter((p) => external.has(p));
      const alreadyManaged = supportedPaths.length - importable.length;
      let added = 0;
      let dups = 0;
      let failed = 0;
      let lastId: number | null = null;
      // Managed copies actually created, for the post-import metadata scans.
      const managedPaths: string[] = [];

      for (const path of importable) {
        const fname = basename(path);
        // Copy the file into the managed library first; new imports land in
        // Uncategorized ("" → that folder) until a type is set re-files them.
        let managedPath: string;
        try {
          managedPath = await importToLibrary(path, "");
        } catch {
          failed++;
          continue;
        }
        try {
          lastId = await createSample({
            name: filenameWithoutExt(fname),
            original_filename: fname,
            file_path: managedPath,
            original_path: path,
            source: parentFolderName(path),
          });
          managedPaths.push(managedPath);
          added++;
        } catch (err) {
          if (err instanceof DuplicateSampleError) {
            dups++;
            // The source is already in the library — drop the copy we just made
            // so the library doesn't accumulate an orphan.
            await deleteLibraryFile(managedPath).catch(() => {});
          } else throw err;
        }
      }

      if (added > 0) {
        await reload();
        if (lastId != null) setSelectedId(lastId);
        // Extract + cache file/audio analysis for imported files. These are
        // best-effort and non-blocking so import feedback stays immediate.
        void scanMetadata(managedPaths);
        void scanHashes(managedPaths);
        void scanAnalysis(managedPaths);
      }

      // Re-importing a known source (dups) and dropping a file that's already in
      // the library (alreadyManaged) both mean "already in your library".
      const inLibrary = dups + alreadyManaged;
      const parts: string[] = [];
      if (added) parts.push(`${added} imported`);
      if (inLibrary) parts.push(`${inLibrary} already in library`);
      if (failed) parts.push(`${failed} failed to copy`);
      if (bad) parts.push(`${bad} unsupported`);
      if (parts.length) {
        notify(parts.join(" · "), added ? "success" : "info");
      } else if (label === "Drop") {
        notify("Drop audio files to import them", "info");
      }
    },
    [notify, reload, scanAnalysis, scanHashes, scanMetadata],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          // Ignore the app's own file being dragged out and back over the
          // window — don't treat it as an import target or a duplicate.
          if (isExportInProgress()) {
            setDropActive(false);
            return;
          }
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDropActive(true);
            return;
          }
          if (event.payload.type === "leave") {
            setDropActive(false);
            return;
          }
          setDropActive(false);
          void importPaths(event.payload.paths, "Drop");
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {
          // Browser-only dev mode does not provide Tauri webview events.
        });
    } catch {
      // `getCurrentWebview()` itself throws outside the Tauri runtime.
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importPaths]);

  // ---- Actions --------------------------------------------------------------
  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const selection = await open({
        multiple: true,
        filters: [
          { name: "Audio", extensions: [...SUPPORTED_EXTENSIONS] },
        ],
      });
      if (selection == null) return; // user cancelled — not an error

      const paths = Array.isArray(selection) ? selection : [selection];
      await importPaths(paths);
    } catch (err) {
      notify(`Import failed: ${err}`, "error");
    } finally {
      setImporting(false);
    }
  }, [importPaths, notify]);

  const handleSave = useCallback(
    async (id: number, meta: SampleMetadata, tags: string[]) => {
      setSaving(true);
      try {
        const before = samples.find((s) => s.id === id);
        await updateSample(id, meta);
        await setSampleTags(id, tags);
        // Keep the on-disk folder in sync with the sample's type. Best-effort:
        // a file that isn't in the managed library (e.g. one left external by
        // the migration) is rejected by the backend and simply left in place.
        const newType = meta.type ?? "";
        const oldType = before?.type ?? "";
        if (before && newType !== oldType) {
          try {
            const moved = await refileInLibrary(before.file_path, newType);
            if (moved !== before.file_path) await setFilePath(id, moved);
          } catch {
            // Not in the library / move failed — leave the file where it is.
          }
        }
        await reload();
        notify("Changes saved", "success");
      } catch (err) {
        // The two writes aren't a single transaction (the SQL plugin pools
        // connections, so a client-side BEGIN/COMMIT can't be trusted), so a
        // failure may leave metadata saved without tags. Resync the UI to the
        // database's actual state rather than leaving it showing stale data.
        await reload().catch(() => {});
        notify(`Could not save changes: ${err}`, "error");
      } finally {
        setSaving(false);
      }
    },
    [notify, reload, samples],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        const sample = samples.find((s) => s.id === id);
        // Remove the DB row first; the managed copy is then deleted best-effort.
        // The user's original file (copy-mode import) is never touched.
        await deleteSample(id);
        if (sample) await deleteLibraryFile(sample.file_path).catch(() => {});
        if (selectedId === id) setSelectedId(null);
        await reload();
        notify("Removed from library", "info");
      } catch (err) {
        notify(`Could not remove sample: ${err}`, "error");
      }
    },
    [notify, reload, selectedId, samples],
  );

  const handleReveal = useCallback(
    async (filePath: string) => {
      try {
        await revealInFinder(filePath);
      } catch (err) {
        if (err instanceof FileNotFoundError) notify(FILE_MISSING_MESSAGE, "error");
        else notify(`Could not open Finder: ${err}`, "error");
      }
    },
    [notify],
  );

  const handleRelink = useCallback(
    async (id: number) => {
      try {
        const selection = await open({
          multiple: false,
          filters: [{ name: "Audio", extensions: [...SUPPORTED_EXTENSIONS] }],
        });
        if (selection == null) return; // cancelled
        const path = Array.isArray(selection) ? selection[0] : selection;

        // Copy the chosen file into the managed library, then point the row at
        // the managed copy (keeping the library self-contained).
        const sample = samples.find((s) => s.id === id);
        const managedPath = await importToLibrary(path, sample?.type ?? "");
        await relinkSample(id, managedPath, basename(path));
        await reload();
        void scanMetadata([managedPath]);
        void scanHashes([managedPath]);
        void scanAnalysis([managedPath]);
        notify("Sample relinked", "success");
      } catch (err) {
        if (err instanceof DuplicateSampleError) {
          notify("That file is already linked to another sample.", "error");
        } else {
          notify(`Could not relink: ${err}`, "error");
        }
      }
    },
    [notify, reload, samples, scanAnalysis, scanHashes, scanMetadata],
  );

  // Toggling a favorite is a lightweight, standalone action, so update local
  // state optimistically rather than refetching the whole library. If the write
  // fails, reload to resync with the database's actual state.
  const handleToggleFavorite = useCallback(
    async (id: number, value: boolean) => {
      setSamples((prev) =>
        prev.map((s) => (s.id === id ? { ...s, is_favorite: value } : s)),
      );
      try {
        await setFavorite(id, value);
      } catch (err) {
        await reload().catch(() => {});
        notify(`Could not update favorite: ${err}`, "error");
      }
    },
    [notify, reload],
  );

  const updateFilters = useCallback(
    (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })),
    [],
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="app-title">Sample Tracker</h1>
        <SearchBar value={search} onChange={setSearch} />
        <AddSampleButton onClick={handleImport} importing={importing} />
      </header>

      <FilterBar
        filters={filters}
        onChange={updateFilters}
        onClear={() => {
          setFilters(EMPTY_FILTERS);
          setOnlyMissing(false);
          setOnlyFavorites(false);
        }}
        allTags={allTags}
        keys={keys}
        moods={moods}
        missingCount={missingIds.size}
        onlyMissing={onlyMissing}
        onToggleMissing={() => setOnlyMissing((v) => !v)}
        onlyFavorites={onlyFavorites}
        onToggleFavorites={() => setOnlyFavorites((v) => !v)}
        onRescan={handleRescan}
      />

      <main className="content">
        <section className="list-pane">
          {loading ? (
            <div className="empty-state">
              <p className="empty-title">
                {migrating ? "Setting up your library…" : "Loading library…"}
              </p>
              {migrating && (
                <p className="empty-sub">
                  Copying your samples into the managed library. This happens
                  once and can take a moment for large libraries.
                </p>
              )}
              <div className="loading-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : loadError ? (
            <div className="empty-state">
              <p className="empty-title">Could not open the database</p>
              <p className="empty-sub">
                The desktop runtime could not open the local SQLite library.
                Restart the app; if it keeps happening, check the app config
                directory permissions.
              </p>
              <p className="empty-code">{loadError}</p>
            </div>
          ) : (
            <SampleList
              samples={visible}
              selectedId={selectedId}
              missingIds={missingIds}
              onSelect={requestSelect}
              onToggleFavorite={handleToggleFavorite}
              onImport={handleImport}
              totalCount={samples.length}
              missingCount={missingIds.size}
            />
          )}
        </section>

        <aside className="detail-pane">
          {selected ? (
            <SampleEditor
              key={selected.id}
              sample={selected}
              allTags={allTags}
              saving={saving}
              missing={missingIds.has(selected.id)}
              exactDuplicateCount={groupSizeForSample(exactGroups, selected.id)}
              nearDuplicateCount={groupSizeForSample(nearGroups, selected.id)}
              onSave={handleSave}
              onDelete={handleDelete}
              onReveal={handleReveal}
              onCopy={handleCopy}
              onRelink={handleRelink}
              onToggleFavorite={handleToggleFavorite}
              onClose={() => requestSelect(null)}
              onDirtyChange={handleDirtyChange}
            />
          ) : (
            <div className="detail-empty">
              <p className="empty-title">No sample selected</p>
              <p className="empty-sub">
                Pick a sample from the list to view and edit its details.
              </p>
            </div>
          )}
        </aside>
      </main>

      <AudioPlayer sample={selected} onError={(msg) => notify(msg, "error")} />

      {dropActive ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-panel">
            <strong>Drop audio files to import</strong>
            <span>Files stay in place; Sample Tracker stores paths only.</span>
          </div>
        </div>
      ) : null}

      <button
        className="help-btn"
        title="Space = play/pause · Files never move or upload"
        aria-label="Help"
        onClick={() => setHelpOpen(true)}
      >
        <HelpCircle size={18} />
      </button>

      {helpOpen ? <KeyboardHelp onClose={() => setHelpOpen(false)} /> : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
