import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Sample, SampleMetadata } from "../types/sample";
import {
  deleteSample,
  DuplicateSampleError,
  relinkSample,
  setFavorite,
  saveSample,
} from "../db/samples";
import {
  basename,
  deleteLibraryFile,
  FileNotFoundError,
  importToLibrary,
  refileSample,
  revealInFinder,
  SUPPORTED_EXTENSIONS,
} from "../lib/files";
import { FILE_MISSING_MESSAGE } from "../lib/audio";
import type { ToastKind } from "../components/Toast";

type Notify = (text: string, kind?: ToastKind) => void;
type Scan = (paths: string[]) => Promise<void>;

type UseSampleActionsOptions = {
  samples: Sample[];
  setSamples: Dispatch<SetStateAction<Sample[]>>;
  selectedSamples: Sample[];
  notify: Notify;
  reload: () => Promise<void>;
  scanMetadata: Scan;
  scanHashes: Scan;
  scanAnalysis: Scan;
  removeIdsFromSelection: (removedIds: Set<number>) => void;
};

export function useSampleActions({
  samples,
  setSamples,
  selectedSamples,
  notify,
  reload,
  scanMetadata,
  scanHashes,
  scanAnalysis,
  removeIdsFromSelection,
}: UseSampleActionsOptions) {
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(
    async (id: number, meta: SampleMetadata, tags: string[]) => {
      setSaving(true);
      try {
        const before = samples.find((s) => s.id === id);
        await saveSample(id, meta, tags);
        const newType = meta.type ?? "";
        const oldType = before?.type ?? "";
        let refileFailed = false;
        if (before && newType !== oldType) {
          try {
            await refileSample(id, before.file_path, newType);
          } catch {
            refileFailed = true;
          }
        }
        await reload();
        notify(
          refileFailed
            ? "Changes saved, but the file could not be moved to its type folder"
            : "Changes saved",
          refileFailed ? "info" : "success",
        );
      } catch (err) {
        await reload().catch(() => {});
        notify(`Could not save changes: ${err}`, "error");
      } finally {
        setSaving(false);
      }
    },
    [notify, reload, samples],
  );

  const handleDeleteMany = useCallback(
    async (ids: number[]) => {
      const targets = samples.filter((sample) => ids.includes(sample.id));
      let removed = 0;
      let failed = 0;
      let cleanupFailed = 0;
      const removedIds = new Set<number>();

      for (const sample of targets) {
        try {
          await deleteSample(sample.id);
          removed++;
          removedIds.add(sample.id);
          try {
            await deleteLibraryFile(sample.file_path);
          } catch {
            cleanupFailed++;
          }
        } catch {
          failed++;
        }
      }

      removeIdsFromSelection(removedIds);
      await reload().catch(() => {});

      if (failed > 0) {
        notify(
          `${removed} removed · ${failed} failed${
            cleanupFailed ? ` · ${cleanupFailed} files need manual cleanup` : ""
          }`,
          "error",
        );
      } else if (cleanupFailed > 0) {
        notify(
          `${removed} removed · ${cleanupFailed} managed files could not be deleted`,
          "error",
        );
      } else {
        notify(
          removed === 1 ? "Removed from library" : `${removed} removed`,
          "info",
        );
      }
    },
    [notify, reload, removeIdsFromSelection, samples],
  );

  const handleDelete = useCallback(
    (id: number) => handleDeleteMany([id]),
    [handleDeleteMany],
  );

  const handleDeleteSelection = useCallback(() => {
    if (selectedSamples.length === 0) return;
    const ok = window.confirm(
      `Remove ${selectedSamples.length} selected samples from the library? Their original audio files will not be deleted.`,
    );
    if (ok) void handleDeleteMany(selectedSamples.map((sample) => sample.id));
  }, [handleDeleteMany, selectedSamples]);

  const handleReveal = useCallback(
    async (filePath: string) => {
      try {
        await revealInFinder(filePath);
      } catch (err) {
        if (err instanceof FileNotFoundError)
          notify(FILE_MISSING_MESSAGE, "error");
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
        if (selection == null) return;
        const path = Array.isArray(selection) ? selection[0] : selection;

        const sample = samples.find((s) => s.id === id);
        const managedPath = await importToLibrary(path, sample?.type ?? "");
        try {
          await relinkSample(id, managedPath, path, basename(path));
        } catch (err) {
          await deleteLibraryFile(managedPath).catch(() => {});
          throw err;
        }
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
    [notify, reload, setSamples],
  );

  return {
    saving,
    handleSave,
    handleDelete,
    handleDeleteSelection,
    handleReveal,
    handleRelink,
    handleToggleFavorite,
  };
}
