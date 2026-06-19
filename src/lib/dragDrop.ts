import { isSupportedAudio } from "./files";

/**
 * Filters paths dropped *onto* the app for import: keeps supported audio files
 * and de-duplicates exact paths while preserving order. (Dragging files *out*
 * of the app is handled natively — see `lib/dragExport.ts`.)
 */
export function supportedDroppedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (!isSupportedAudio(path) || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}
