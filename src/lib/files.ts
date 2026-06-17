import { invoke } from "@tauri-apps/api/core";

/** Audio extensions accepted by the importer. */
export const SUPPORTED_EXTENSIONS = [
  "wav",
  "mp3",
  "aiff",
  "aif",
  "flac",
  "m4a",
  "ogg",
] as const;

/** Last path segment, handling both "/" and "\" separators. */
export function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Lower-cased extension without the dot ("" when none). */
export function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : "";
}

/** Filename with its extension stripped — used as the default sample name. */
export function filenameWithoutExt(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(0, idx) : filename;
}

/** Name of the folder directly containing the file (used as default source). */
export function parentFolderName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

export function isSupportedAudio(p: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(p));
}

/** Thrown when the backend reports the file no longer exists on disk. */
export class FileNotFoundError extends Error {
  constructor(public filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = "FileNotFoundError";
  }
}

/**
 * Reveals (and selects, where supported) the sample file in the OS file
 * manager via a Rust command. Never modifies the file or the database.
 */
export async function revealInFinder(filePath: string): Promise<void> {
  try {
    await invoke("reveal_in_finder", { path: filePath });
  } catch (err) {
    if (String(err).includes("not_found")) {
      throw new FileNotFoundError(filePath);
    }
    throw err;
  }
}

/** Whether the path currently exists on disk (Rust-backed check). */
export async function pathExists(filePath: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path: filePath });
}

/**
 * Returns the set of paths (from the given list) that no longer exist on disk.
 * One batched IPC call, so scanning the whole library is cheap.
 */
export async function findMissingPaths(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const missing = await invoke<string[]>("missing_paths", { paths });
  return new Set(missing);
}
