import { createSample, DuplicateSampleError } from "../db/samples";
import {
  basename,
  deleteLibraryFile,
  filenameWithoutExt,
  importToLibrary,
  parentFolderName,
  unmanagedPaths,
} from "./files";
import { supportedDroppedPaths } from "./dragDrop";
import type { ImportSummaryCounts } from "./importSummary";

/** Side effects + options the import loop needs, injected so it stays testable. */
export type ImportBatchDeps = {
  /** Re-runs the one refresh path after any successful import. */
  reload: () => Promise<void>;
  /** Background metadata/hash/analysis scans, fired after import. */
  scanMetadata: (paths: string[]) => Promise<void>;
  scanHashes: (paths: string[]) => Promise<void>;
  scanAnalysis: (paths: string[]) => Promise<void>;
  /** Optional: select the last-imported sample (skip for background rescans). */
  selectImportedSample?: (id: number) => void;
  /** Optional progress callback, called with (done, total) as each file copies. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Optional: source paths already in the library (a sample's `original_path`).
   * Lets a folder rescan skip already-imported files cheaply, without a
   * copy-then-delete round trip per duplicate. The `original_path UNIQUE`
   * constraint is still the authoritative backstop.
   */
  knownOriginalPaths?: Set<string>;
};

/** Outcome counts of an import batch, plus the last new sample id. */
export type ImportBatchResult = ImportSummaryCounts & {
  lastId: number | null;
};

/**
 * Copies a batch of source files into the managed library, one at a time, and
 * inserts a sample row for each. Unsupported paths are filtered out, files
 * already inside the library or already imported (by `original_path`) are
 * skipped, and a managed copy is rolled back if its database insert fails. This
 * is the shared core behind both the file/folder picker, drag-drop, and the
 * folder rescan. It performs no UI itself — it returns counts so the caller can
 * compose the right message.
 */
export async function importPaths(
  paths: string[],
  deps: ImportBatchDeps,
): Promise<ImportBatchResult> {
  const supportedPaths = supportedDroppedPaths(paths);
  const unsupported = paths.length - supportedPaths.length;
  const external = await unmanagedPaths(supportedPaths);
  const known = deps.knownOriginalPaths ?? new Set<string>();
  const importable = supportedPaths.filter(
    (p) => external.has(p) && !known.has(p),
  );
  // Everything not importable was either already inside the library or already
  // imported from this source path.
  const alreadyInLibrary = supportedPaths.length - importable.length;

  let added = 0;
  let dups = 0;
  let failed = 0;
  let lastId: number | null = null;
  const managedPaths: string[] = [];

  const total = importable.length;
  let done = 0;
  deps.onProgress?.(0, total);

  for (const path of importable) {
    const fname = basename(path);
    let managedPath: string;
    try {
      managedPath = await importToLibrary(path, "");
    } catch {
      failed++;
      deps.onProgress?.(++done, total);
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
      } else {
        failed++;
      }
      await deleteLibraryFile(managedPath).catch(() => {});
    }
    deps.onProgress?.(++done, total);
  }

  if (added > 0) {
    await deps.reload();
    if (lastId != null) deps.selectImportedSample?.(lastId);
    void deps.scanMetadata(managedPaths);
    void deps.scanHashes(managedPaths);
    void deps.scanAnalysis(managedPaths);
  }

  return {
    added,
    inLibrary: alreadyInLibrary + dups,
    failed,
    unsupported,
    lastId,
  };
}
