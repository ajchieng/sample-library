import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { scanPaths, SUPPORTED_EXTENSIONS } from "../lib/files";
import { isExportInProgress } from "../lib/dragExport";
import { formatImportSummary } from "../lib/importSummary";
import { importPaths as runImportBatch } from "../lib/importBatch";
import type { ToastKind } from "../components/Toast";

type Notify = (text: string, kind?: ToastKind) => void;
type Scan = (paths: string[]) => Promise<void>;

type UseSampleImportOptions = {
  notify: Notify;
  reload: () => Promise<void>;
  scanMetadata: Scan;
  scanHashes: Scan;
  scanAnalysis: Scan;
  selectImportedSample: (id: number) => void;
  autoTag: boolean;
};

export function useSampleImport({
  notify,
  reload,
  scanMetadata,
  scanHashes,
  scanAnalysis,
  selectImportedSample,
  autoTag,
}: UseSampleImportOptions) {
  const [importing, setImporting] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const importPaths = useCallback(
    async (paths: string[], label = "Import") => {
      const result = await runImportBatch(paths, {
        reload,
        scanMetadata,
        scanHashes,
        scanAnalysis,
        selectImportedSample,
        autoTag,
      });

      const summary = formatImportSummary(result);
      if (summary) {
        notify(summary, result.added ? "success" : "info");
      } else if (label === "Drop") {
        notify("Drop audio files to import them", "info");
      }
    },
    [
      notify,
      reload,
      scanAnalysis,
      scanHashes,
      scanMetadata,
      selectImportedSample,
      autoTag,
    ],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
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
          // Expand any dropped folders into the audio files they contain (and
          // keep dropped audio files) before importing.
          void scanPaths(event.payload.paths)
            .then((audioPaths) => importPaths(audioPaths, "Drop"))
            .catch((err) => {
              notify(`Import failed: ${err}`, "error");
            });
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
  }, [importPaths, notify]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const selection = await open({
        multiple: true,
        filters: [{ name: "Audio", extensions: [...SUPPORTED_EXTENSIONS] }],
      });
      if (selection == null) return;

      const paths = Array.isArray(selection) ? selection : [selection];
      await importPaths(paths);
    } catch (err) {
      notify(`Import failed: ${err}`, "error");
    } finally {
      setImporting(false);
    }
  }, [importPaths, notify]);

  return { importing, dropActive, handleImport };
}
