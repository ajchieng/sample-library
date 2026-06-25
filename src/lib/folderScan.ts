/**
 * Pure diff between what a folder scan found and what the library already knows.
 * No IPC, no database — just set logic over paths, so it is unit-testable.
 *
 * In the copy-into-library model a watched folder is a *source*: scanning copies
 * new files in, and a file disappearing from the source never touches the owned
 * copy. So this reports two things:
 *  - `toImport`: scanned source files not yet imported (by `original_path`).
 *  - `removedAtSource`: previously-imported sources, under a watched root, that
 *    the scan no longer finds (deleted or moved away). Informational only.
 */
export type FolderScanInput = {
  /** Absolute audio file paths returned by the scan. */
  scannedPaths: string[];
  /** `original_path` of every existing sample. */
  knownOriginalPaths: Iterable<string>;
  /** The watched folder roots covered by this scan. */
  watchedRoots: string[];
};

export type FolderScanDiff = {
  toImport: string[];
  removedAtSource: string[];
};

/** Whether `path` is `folder` itself or lives somewhere beneath it. */
export function pathIsUnder(path: string, folder: string): boolean {
  if (path === folder) return true;
  const sep = folder.includes("\\") ? "\\" : "/";
  const base = folder.endsWith(sep) ? folder : folder + sep;
  return path.startsWith(base);
}

export function diffFolderScan({
  scannedPaths,
  knownOriginalPaths,
  watchedRoots,
}: FolderScanInput): FolderScanDiff {
  const known = new Set(knownOriginalPaths);
  const scanned = new Set(scannedPaths);

  const seen = new Set<string>();
  const toImport: string[] = [];
  for (const path of scannedPaths) {
    if (!known.has(path) && !seen.has(path)) {
      seen.add(path);
      toImport.push(path);
    }
  }

  const removedAtSource: string[] = [];
  for (const original of known) {
    if (scanned.has(original)) continue;
    if (watchedRoots.some((root) => pathIsUnder(original, root))) {
      removedAtSource.push(original);
    }
  }

  return { toImport, removedAtSource };
}
