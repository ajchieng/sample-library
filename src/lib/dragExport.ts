import { resolveResource } from "@tauri-apps/api/path";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

export type SampleDragOptions = {
  item: string[];
  icon: string;
  mode: "copy";
};

/**
 * Builds the native-drag payload for a sample. `mode: "copy"` means dropping it
 * into Finder/a DAW writes a *copy* of the file — the library's original is
 * never moved (the local-first invariant holds). Pure, so it's unit-testable.
 */
export function dragOptionsForSample(
  filePath: string,
  iconPath: string,
): SampleDragOptions {
  return { item: [filePath], icon: iconPath, mode: "copy" };
}

// The drag preview image is bundled as a Tauri resource (see tauri.conf.json
// `bundle.resources`). Resolve its absolute path once and reuse it.
let iconPromise: Promise<string> | null = null;
function dragIconPath(): Promise<string> {
  if (!iconPromise) {
    // Fall back to no preview image rather than failing the drag (e.g. in
    // browser dev where resource resolution isn't available).
    iconPromise = resolveResource("icons/128x128.png").catch(() => "");
  }
  return iconPromise;
}

// True while a library file is being dragged OUT of the app. The drop handler
// reads this to ignore the app's own file being dragged back over the window,
// so a sample can't be accidentally re-imported (duplicated) by dropping it on
// the app.
let exporting = false;

/** Whether a native drag-out of a library file is currently in progress. */
export function isExportInProgress(): boolean {
  return exporting;
}

/**
 * Starts a native OS drag of the sample's file. Unlike an HTML5 drag from the
 * webview, this is recognized by native apps (Finder, Logic, …) as a real file
 * drag, dropping a copy of the audio. Never throws — outside the Tauri runtime
 * (or if the drag session can't begin) it simply no-ops so the row stays
 * responsive. `onEnd` runs when the drag finishes (dropped or cancelled).
 */
export async function startSampleDrag(
  filePath: string,
  onEnd?: () => void,
): Promise<void> {
  exporting = true;
  const finish = () => {
    exporting = false;
    onEnd?.();
  };
  try {
    const icon = await dragIconPath();
    await startDrag(dragOptionsForSample(filePath, icon), finish);
  } catch {
    finish();
  }
}
