import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { HelpCircle } from "lucide-react";

import type { Sample, SampleMetadata } from "./types/sample";
import {
  createSample,
  deleteSample,
  DuplicateSampleError,
  listAllTags,
  listSamples,
  relinkSample,
  setSampleTags,
  updateSample,
} from "./db/samples";
import {
  basename,
  filenameWithoutExt,
  FileNotFoundError,
  findMissingPaths,
  isSupportedAudio,
  parentFolderName,
  revealInFinder,
  SUPPORTED_EXTENSIONS,
} from "./lib/files";
import { FILE_MISSING_MESSAGE } from "./lib/audio";

import { SearchBar } from "./components/SearchBar";
import { AddSampleButton } from "./components/AddSampleButton";
import { FilterBar, EMPTY_FILTERS, type Filters } from "./components/FilterBar";
import { SampleList } from "./components/SampleList";
import { SampleEditor } from "./components/SampleEditor";
import { AudioPlayer } from "./components/AudioPlayer";
import { Toast, type ToastKind, type ToastMessage } from "./components/Toast";

export default function App() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [onlyMissing, setOnlyMissing] = useState(false);

  // IDs of samples whose file is no longer on disk (derived, not persisted).
  const [missingIds, setMissingIds] = useState<Set<number>>(new Set());

  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

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
    setSamples(nextSamples);
    setAllTags(nextTags);
    await refreshMissing(nextSamples);
  }, [refreshMissing]);

  const handleRescan = useCallback(async () => {
    const missing = await refreshMissing(samples);
    notify(
      missing.size
        ? `${missing.size} file${missing.size === 1 ? "" : "s"} missing`
        : "All files found",
      missing.size ? "error" : "success",
    );
  }, [refreshMissing, samples, notify]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // Don't strand the "only missing" filter once nothing is missing anymore
  // (the toggle that turns it off is hidden when the count hits zero).
  useEffect(() => {
    if (onlyMissing && missingIds.size === 0) setOnlyMissing(false);
  }, [onlyMissing, missingIds]);

  // ---- Derived filter option lists -----------------------------------------
  const keys = useMemo(
    () =>
      Array.from(
        new Set(samples.map((s) => s.musical_key).filter(Boolean) as string[]),
      ).sort(),
    [samples],
  );
  const moods = useMemo(
    () =>
      Array.from(
        new Set(samples.map((s) => s.mood).filter(Boolean) as string[]),
      ).sort(),
    [samples],
  );

  // ---- Search + filtering ---------------------------------------------------
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = filters.bpmMin ? Number(filters.bpmMin) : null;
    const max = filters.bpmMax ? Number(filters.bpmMax) : null;

    return samples.filter((s) => {
      if (onlyMissing && !missingIds.has(s.id)) return false;
      if (filters.type && s.type !== filters.type) return false;
      if (filters.tag && !s.tags.includes(filters.tag)) return false;
      if (filters.key && s.musical_key !== filters.key) return false;
      if (filters.mood && (s.mood ?? "") !== filters.mood) return false;
      if (min != null && (s.bpm == null || s.bpm < min)) return false;
      if (max != null && (s.bpm == null || s.bpm > max)) return false;

      if (q) {
        const haystack = [
          s.name,
          s.type,
          s.mood,
          s.musical_key,
          s.notes,
          s.source,
          s.original_filename,
          ...s.tags,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [samples, search, filters, onlyMissing, missingIds]);

  const selected = useMemo(
    () => samples.find((s) => s.id === selectedId) ?? null,
    [samples, selectedId],
  );

  // ---- Keyboard navigation --------------------------------------------------
  // Up/Down (and Home/End) move the selection through the visible list, loading
  // each sample into the editor and player. Spacebar (handled in AudioPlayer)
  // then auditions it. Ignored while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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

      setSelectedId(visible[next].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, selectedId]);

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
      let added = 0;
      let dups = 0;
      let bad = 0;
      let lastId: number | null = null;

      for (const path of paths) {
        if (!isSupportedAudio(path)) {
          bad++;
          continue;
        }
        const fname = basename(path);
        try {
          lastId = await createSample({
            name: filenameWithoutExt(fname),
            original_filename: fname,
            file_path: path,
            source: parentFolderName(path),
          });
          added++;
        } catch (err) {
          if (err instanceof DuplicateSampleError) dups++;
          else throw err;
        }
      }

      await reload();
      if (lastId != null) setSelectedId(lastId);

      const parts: string[] = [];
      if (added) parts.push(`${added} imported`);
      if (dups) parts.push(`${dups} already in library`);
      if (bad) parts.push(`${bad} unsupported`);
      if (parts.length) {
        notify(parts.join(" · "), added ? "success" : "info");
      }
    } catch (err) {
      notify(`Import failed: ${err}`, "error");
    } finally {
      setImporting(false);
    }
  }, [notify, reload]);

  const handleSave = useCallback(
    async (id: number, meta: SampleMetadata, tags: string[]) => {
      setSaving(true);
      try {
        await updateSample(id, meta);
        await setSampleTags(id, tags);
        await reload();
        notify("Changes saved", "success");
      } catch (err) {
        notify(`Could not save changes: ${err}`, "error");
      } finally {
        setSaving(false);
      }
    },
    [notify, reload],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteSample(id);
        if (selectedId === id) setSelectedId(null);
        await reload();
        notify("Removed from library — the file is untouched", "info");
      } catch (err) {
        notify(`Could not remove sample: ${err}`, "error");
      }
    },
    [notify, reload, selectedId],
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

        await relinkSample(id, path, basename(path));
        await reload();
        notify("Sample relinked", "success");
      } catch (err) {
        if (err instanceof DuplicateSampleError) {
          notify("That file is already linked to another sample.", "error");
        } else {
          notify(`Could not relink: ${err}`, "error");
        }
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
        }}
        allTags={allTags}
        keys={keys}
        moods={moods}
        missingCount={missingIds.size}
        onlyMissing={onlyMissing}
        onToggleMissing={() => setOnlyMissing((v) => !v)}
        onRescan={handleRescan}
      />

      <main className="content">
        <section className="list-pane">
          {loading ? (
            <div className="empty-state">
              <p className="empty-title">Loading library…</p>
            </div>
          ) : loadError ? (
            <div className="empty-state">
              <p className="empty-title">Could not open the database</p>
              <p className="empty-sub">{loadError}</p>
            </div>
          ) : (
            <SampleList
              samples={visible}
              selectedId={selectedId}
              missingIds={missingIds}
              onSelect={setSelectedId}
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
              onSave={handleSave}
              onDelete={handleDelete}
              onReveal={handleReveal}
              onRelink={handleRelink}
              onClose={() => setSelectedId(null)}
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

      <button
        className="help-btn"
        title="Space = play/pause · Files never move or upload"
        aria-label="Help"
      >
        <HelpCircle size={18} />
      </button>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
