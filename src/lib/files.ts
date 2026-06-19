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
 * Places references to the given library files on the system clipboard so they
 * can be pasted elsewhere (e.g. ⌘V into Finder). The files are never read,
 * moved, or modified — only file references go on the pasteboard.
 */
export async function copyFilesToClipboard(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await invoke("copy_files_to_clipboard", { paths });
}

/**
 * Grants the webview asset-protocol read access to exactly these file paths.
 * The configured asset scope is empty, so this must be called with the
 * library's paths before any audio can stream. Idempotent — safe to call on
 * every reload.
 */
export async function allowAssetFiles(paths: string[]): Promise<void> {
  await invoke("allow_asset_files", { paths });
}

/**
 * Copies an audio file into the managed library under `library/<subfolder>/`
 * (a sanitized, per-type subfolder; "" → "Uncategorized"), returning the
 * absolute path of the new copy. The source file is never moved or modified.
 * Throws FileNotFoundError when the source no longer exists.
 */
export async function importToLibrary(
  sourcePath: string,
  subfolder: string,
): Promise<string> {
  try {
    return await invoke<string>("import_to_library", { sourcePath, subfolder });
  } catch (err) {
    if (String(err).includes("not_found")) {
      throw new FileNotFoundError(sourcePath);
    }
    throw err;
  }
}

/**
 * Moves an already-managed file into a different per-type subfolder (after its
 * `type` changes), returning the new absolute path. No-ops when the file is
 * already in the right folder. Files outside the library root are rejected.
 */
export async function refileSample(
  id: number,
  currentPath: string,
  subfolder: string,
): Promise<string> {
  return invoke<string>("refile_sample", { id, currentPath, subfolder });
}

/**
 * Deletes the managed copy of a file when a sample is removed. Guarded in Rust
 * to only ever delete files inside the library root; a missing file is treated
 * as success.
 */
export async function deleteLibraryFile(path: string): Promise<void> {
  await invoke("delete_library_file", { path });
}

/**
 * Returns the set of paths (from the given list) that do NOT live inside the
 * managed library — i.e. files still referenced in their original external
 * location. Used by the one-time migration to find what to copy in.
 */
export async function unmanagedPaths(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const external = await invoke<string[]>("unmanaged_paths", { paths });
  return new Set(external);
}

/** Audio metadata read from a file header by the Rust `read_metadata` command. */
export type AudioMetaResult = {
  path: string;
  duration_seconds: number | null;
  sample_rate: number | null;
  channels: number | null;
};

/** Exact hash result from the Rust `hash_files` command. */
export type FileHashResult = {
  path: string;
  file_size: number | null;
  content_hash: string | null;
  status: "ok" | "error";
  error: string | null;
};

/** BPM/key/fingerprint result from the Rust `analyze_audio` command. */
export type AudioAnalysisResult = {
  path: string;
  detected_bpm: number | null;
  detected_bpm_confidence: number | null;
  detected_key: string | null;
  detected_key_confidence: number | null;
  audio_fingerprint: string | null;
  fingerprint_version: number | null;
  status: "ok" | "error";
  error: string | null;
};

/**
 * Reads audio metadata (duration / sample rate / channels) from file headers
 * via Rust. Batched into one IPC call; returns one result per input path and
 * never throws per file (unreadable files come back with null fields).
 */
export async function readMetadata(
  paths: string[],
): Promise<AudioMetaResult[]> {
  if (paths.length === 0) return [];
  return invoke<AudioMetaResult[]>("read_metadata", { paths });
}

/** Computes exact hashes for duplicate detection. */
export async function hashFiles(paths: string[]): Promise<FileHashResult[]> {
  if (paths.length === 0) return [];
  return invoke<FileHashResult[]>("hash_files", { paths });
}

/** Runs bounded read-only BPM/key/fingerprint analysis. */
export async function analyzeAudio(
  paths: string[],
): Promise<AudioAnalysisResult[]> {
  if (paths.length === 0) return [];
  return invoke<AudioAnalysisResult[]>("analyze_audio", { paths });
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
