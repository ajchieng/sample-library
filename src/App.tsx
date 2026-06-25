import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HelpCircle } from "lucide-react";

import { copyFilesToClipboard } from "./lib/files";
import {
  exactDuplicateGroups,
  groupSizeForSample,
  nearDuplicateGroups,
} from "./lib/analysis";
import {
  deriveFilterOptions,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterSamples,
  sortSamples,
  type SampleFilters,
  type SampleSort,
  type SortKey,
} from "./lib/sampleView";

import { SearchBar } from "./components/SearchBar";
import { AddSampleButton } from "./components/AddSampleButton";
import { FolderControls } from "./components/FolderControls";
import { ActivityChip } from "./components/ActivityChip";
import { FilterBar } from "./components/FilterBar";
import { SampleList } from "./components/SampleList";
import { SampleEditor } from "./components/SampleEditor";
import { AudioPlayer } from "./components/AudioPlayer";
import { ScanProgress } from "./components/ScanProgress";
import { Toast, type ToastKind, type ToastMessage } from "./components/Toast";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { WatchedFolders } from "./components/WatchedFolders";
import { ActivityPanel } from "./components/ActivityPanel";
import { BulkSelection } from "./components/BulkSelection";
import { useSampleLibrary } from "./hooks/useSampleLibrary";
import { useBackfillJobs } from "./hooks/useBackfillJobs";
import { useSampleImport } from "./hooks/useSampleImport";
import { useFolderScan } from "./hooks/useFolderScan";
import { useSampleSelection } from "./hooks/useSampleSelection";
import { useSampleActions } from "./hooks/useSampleActions";

export default function App() {
  const [search, setSearch] = useState("");
  // The input stays controlled by `search` for snappy typing; the heavy filter
  // recompute runs at lower priority off the deferred value.
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState<SampleFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SampleSort>(DEFAULT_SORT);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string, kind: ToastKind = "info") => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  const {
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
  } = useSampleLibrary(notify);

  // All background indexing (the initial backfill plus per-import/relink scans)
  // flows through this job manager so it is observable, pausable, and retryable.
  const {
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
  } = useBackfillJobs({
    scanMetadata,
    scanHashes,
    scanAnalysis,
    samples,
    ready: !loading,
  });

  // Callers (import, folder scan, relink) feed work to the job manager rather
  // than calling the scan functions directly, so their indexing is visible too.
  const enqueueScan = useMemo(
    () => ({
      scanMetadata: (paths: string[]) => {
        enqueue("metadata", paths);
        return Promise.resolve();
      },
      scanHashes: (paths: string[]) => {
        enqueue("hash", paths);
        return Promise.resolve();
      },
      scanAnalysis: (paths: string[]) => {
        enqueue("analysis", paths);
        return Promise.resolve();
      },
    }),
    [enqueue],
  );

  useEffect(() => {
    if (onlyMissing && missingIds.size === 0) setOnlyMissing(false);
  }, [onlyMissing, missingIds]);

  // ---- Derived filter option lists -----------------------------------------
  const { keys, moods } = useMemo(
    () => deriveFilterOptions(samples),
    [samples],
  );

  // ---- Search + filtering + sorting -----------------------------------------
  const visible = useMemo(
    () =>
      sortSamples(
        filterSamples(samples, {
          search: deferredSearch,
          filters,
          onlyMissing,
          onlyFavorites,
          missingIds,
        }),
        sort,
      ),
    [
      samples,
      deferredSearch,
      filters,
      onlyMissing,
      onlyFavorites,
      missingIds,
      sort,
    ],
  );

  const handleSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : // New column: ascending for text, descending for numeric/date.
          { key, dir: key === "bpm" || key === "created_at" ? "desc" : "asc" },
    );
  }, []);

  const exactGroups = useMemo(() => exactDuplicateGroups(samples), [samples]);
  const nearGroups = useMemo(() => nearDuplicateGroups(samples), [samples]);

  const handleCopyPaths = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return;
      try {
        await copyFilesToClipboard(filePaths);
        notify(
          filePaths.length === 1
            ? "File copied to clipboard"
            : `${filePaths.length} files copied to clipboard`,
          "success",
        );
      } catch (err) {
        notify(`Could not copy files: ${err}`, "error");
      }
    },
    [notify],
  );
  const handleCopy = useCallback(
    (filePath: string) => handleCopyPaths([filePath]),
    [handleCopyPaths],
  );

  const {
    selectedId,
    selectedIds,
    selected,
    selectedSamples,
    selectedDragPaths,
    singleSelected,
    handleDirtyChange,
    clearSelection,
    requestSelect,
    selectSingle,
    removeIdsFromSelection,
  } = useSampleSelection({
    samples,
    visible,
    missingIds,
    helpOpen,
    setHelpOpen,
    copyPaths: handleCopyPaths,
  });

  const { importing, dropActive, handleImport } = useSampleImport({
    notify,
    reload,
    scanMetadata: enqueueScan.scanMetadata,
    scanHashes: enqueueScan.scanHashes,
    scanAnalysis: enqueueScan.scanAnalysis,
    selectImportedSample: selectSingle,
  });

  const {
    folders,
    scanning,
    scanProgress,
    pickAndScanFolder,
    rescanWatchedFolders,
    removeFolder,
  } = useFolderScan({
    notify,
    reload,
    scanMetadata: enqueueScan.scanMetadata,
    scanHashes: enqueueScan.scanHashes,
    scanAnalysis: enqueueScan.scanAnalysis,
    selectImportedSample: selectSingle,
    samples,
    ready: !loading,
  });

  const {
    saving,
    handleSave,
    handleDelete,
    handleDeleteSelection,
    handleReveal,
    handleRelink,
    handleToggleFavorite,
  } = useSampleActions({
    samples,
    setSamples,
    selectedSamples,
    notify,
    reload,
    scanMetadata: enqueueScan.scanMetadata,
    scanHashes: enqueueScan.scanHashes,
    scanAnalysis: enqueueScan.scanAnalysis,
    removeIdsFromSelection,
  });

  const updateFilters = useCallback(
    (patch: Partial<SampleFilters>) => setFilters((f) => ({ ...f, ...patch })),
    [],
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="app-title">Sample Tracker</h1>
        <SearchBar value={search} onChange={setSearch} />
        <div className="topbar-actions">
          <ActivityChip
            busy={busy}
            paused={paused}
            aggregateDone={aggregateDone}
            aggregateTotal={aggregateTotal}
            totalFailed={totalFailed}
            onClick={() => setActivityOpen(true)}
          />
          <AddSampleButton onClick={handleImport} importing={importing} />
          <FolderControls
            onAddFolder={pickAndScanFolder}
            onOpenManager={() => setFoldersOpen(true)}
            folderCount={folders.length}
            scanning={scanning}
          />
        </div>
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

      <ScanProgress progress={scanProgress} />

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
              activeId={selectedId}
              selectedIds={selectedIds}
              selectedDragPaths={selectedDragPaths}
              missingIds={missingIds}
              onSelect={requestSelect}
              onToggleFavorite={handleToggleFavorite}
              onImport={handleImport}
              totalCount={samples.length}
              missingCount={missingIds.size}
              sort={sort}
              onSort={handleSort}
            />
          )}
        </section>

        <aside className="detail-pane">
          {selectedSamples.length > 1 ? (
            <BulkSelection
              samples={selectedSamples}
              missingCount={
                selectedSamples.filter((sample) => missingIds.has(sample.id))
                  .length
              }
              onCopy={() => void handleCopyPaths(selectedDragPaths)}
              onDelete={handleDeleteSelection}
              onClear={clearSelection}
            />
          ) : singleSelected ? (
            <SampleEditor
              key={singleSelected.id}
              sample={singleSelected}
              allTags={allTags}
              saving={saving}
              missing={missingIds.has(singleSelected.id)}
              exactDuplicateCount={groupSizeForSample(
                exactGroups,
                singleSelected.id,
              )}
              nearDuplicateCount={groupSizeForSample(
                nearGroups,
                singleSelected.id,
              )}
              onSave={handleSave}
              onDelete={handleDelete}
              onReveal={handleReveal}
              onCopy={handleCopy}
              onRelink={handleRelink}
              onToggleFavorite={handleToggleFavorite}
              onClose={clearSelection}
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
            <span>Copied into your library; your originals stay put.</span>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="help-btn"
        title="Space = play/pause · Your original files never move or upload"
        aria-label="Help"
        onClick={() => setHelpOpen(true)}
      >
        <HelpCircle size={18} />
      </button>

      {helpOpen ? <KeyboardHelp onClose={() => setHelpOpen(false)} /> : null}

      {foldersOpen ? (
        <WatchedFolders
          folders={folders}
          scanning={scanning}
          onAddFolder={pickAndScanFolder}
          onRescanAll={rescanWatchedFolders}
          onRemove={removeFolder}
          onClose={() => setFoldersOpen(false)}
        />
      ) : null}

      {activityOpen ? (
        <ActivityPanel
          jobs={jobs}
          recent={recent}
          paused={paused}
          totalFailed={totalFailed}
          onTogglePause={togglePause}
          onRetry={retry}
          onRetryAll={retryAll}
          onClose={() => setActivityOpen(false)}
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
