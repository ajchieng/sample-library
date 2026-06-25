import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Converts a local absolute file path into a URL the webview can load through
 * Tauri's asset protocol, so the <audio> element can stream it without copying
 * or uploading the file.
 */
export function toAudioSrc(filePath: string): string {
  return convertFileSrc(filePath, "sample-audio");
}

export const FILE_MISSING_MESSAGE =
  "This file could not be found. It may have been moved or deleted.";

export const FORMAT_UNSUPPORTED_MESSAGE =
  "This format can't be previewed in the app, but the file is still on disk.";
