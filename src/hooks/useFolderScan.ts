import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Sample } from "../types/sample";
import {
  addWatchedFolder,
  listWatchedFolders,
  removeWatchedFolder,
  setFolderScannedAt,
  type WatchedFolder,
} from "../db/folders";
import { scanPaths } from "../lib/files";
import { importPaths as runImportBatch } from "../lib/importBatch";
import { diffFolderScan } from "../lib/folderScan";
import type { ToastKind } from "../components/Toast";

type Notify = (text: string, kind?: ToastKind) => void;
type Scan = (paths: string[]) => Promise<void>;

/** Live progress of an in-flight scan import. */
export type ScanProgress = { done: number; total: number };

type UseFolderScanOptions = {
  notify: Notify;
  reload: () => Promise<void>;
  scanMetadata: Scan;
  scanHashes: Scan;
  scanAnalysis: Scan;
  selectImportedSample: (id: number) => void;
  /** Current library, used to skip already-imported sources (by original_path). */
  samples: Sample[];
  /** True once the initial library load finished — gates the at-launch rescan. */
  ready: boolean;
};

export function useFolderScan({
  notify,
  reload,
  scanMetadata,
  scanHashes,
  scanAnalysis,
  selectImportedSample,
  samples,
  ready,
}: UseFolderScanOptions) {
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  // Refs keep the scan callbacks stable while always reading current data.
  const samplesRef = useRef(samples);
  samplesRef.current = samples;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  const refreshFolders = useCallback(async () => {
    setFolders(await listWatchedFolders());
  }, []);

  const runScan = useCallback(
    async (roots: string[], folderIds: number[], isLaunch: boolean) => {
      if (roots.length === 0) return;
      setScanning(true);
      setScanProgress({ done: 0, total: 0 });
      try {
        const scanned = await scanPaths(roots);
        const known = new Set(
          samplesRef.current
            .map((s) => s.original_path)
            .filter((p): p is string => Boolean(p)),
        );
        const { toImport, removedAtSource } = diffFolderScan({
          scannedPaths: scanned,
          knownOriginalPaths: known,
          watchedRoots: roots,
        });

        const result = await runImportBatch(toImport, {
          reload,
          scanMetadata,
          scanHashes,
          scanAnalysis,
          knownOriginalPaths: known,
          onProgress: (done, total) => setScanProgress({ done, total }),
          // Don't steal the selection during a background at-launch rescan.
          selectImportedSample: isLaunch ? undefined : selectImportedSample,
        });

        for (const id of folderIds) {
          await setFolderScannedAt(id).catch(() => {});
        }
        await refreshFolders();

        const parts: string[] = [];
        if (result.added) parts.push(`${result.added} imported`);
        if (result.inLibrary)
          parts.push(`${result.inLibrary} already in library`);
        if (result.failed) parts.push(`${result.failed} failed to copy`);
        if (removedAtSource.length) {
          parts.push(`${removedAtSource.length} missing at source`);
        }
        // Keep the launch rescan quiet unless it actually did something.
        const worthShowing = !isLaunch || result.added > 0 || result.failed > 0;
        if (parts.length && worthShowing) {
          notify(parts.join(" · "), result.added ? "success" : "info");
        }
      } catch (err) {
        notify(`Folder scan failed: ${err}`, "error");
      } finally {
        setScanProgress(null);
        setScanning(false);
      }
    },
    [
      notify,
      reload,
      scanAnalysis,
      scanHashes,
      scanMetadata,
      selectImportedSample,
      refreshFolders,
    ],
  );

  const pickAndScanFolder = useCallback(async () => {
    let selection: string | string[] | null;
    try {
      selection = await open({ directory: true, multiple: true });
    } catch (err) {
      notify(`Could not open folder picker: ${err}`, "error");
      return;
    }
    if (selection == null) return;

    const picked = Array.isArray(selection) ? selection : [selection];
    const ids: number[] = [];
    for (const path of picked) {
      ids.push(await addWatchedFolder(path));
    }
    await refreshFolders();
    await runScan(picked, ids, false);
  }, [notify, refreshFolders, runScan]);

  const rescanWatchedFolders = useCallback(async () => {
    const current = foldersRef.current;
    if (current.length === 0) {
      notify("No folders to rescan yet", "info");
      return;
    }
    await runScan(
      current.map((f) => f.path),
      current.map((f) => f.id),
      false,
    );
  }, [notify, runScan]);

  const removeFolder = useCallback(
    async (id: number) => {
      await removeWatchedFolder(id);
      await refreshFolders();
    },
    [refreshFolders],
  );

  // Load remembered folders and rescan them once, after the initial library
  // load. Most rescans import nothing (dedup), so this is cheap and quiet.
  const launched = useRef(false);
  useEffect(() => {
    if (!ready || launched.current) return;
    launched.current = true;
    (async () => {
      const remembered = await listWatchedFolders();
      setFolders(remembered);
      if (remembered.length > 0) {
        await runScan(
          remembered.map((f) => f.path),
          remembered.map((f) => f.id),
          true,
        );
      }
    })().catch((err) => notify(`Folder rescan failed: ${err}`, "error"));
  }, [ready, runScan, notify]);

  return {
    folders,
    scanning,
    scanProgress,
    pickAndScanFolder,
    rescanWatchedFolders,
    removeFolder,
  };
}
