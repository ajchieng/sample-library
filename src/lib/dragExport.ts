import { resolveResource } from "@tauri-apps/api/path";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

export type SampleDragOptions = {
  item: string[];
  icon: string;
  mode: "copy";
};

/**
 * Builds the native-drag payload for one or more samples. `mode: "copy"` means
 * dropping them into Finder/a DAW writes copies — the library originals are
 * never moved. Pure, so it's unit-testable.
 */
export function dragOptionsForSamples(
  filePaths: string[],
  iconPath: string,
): SampleDragOptions {
  return { item: filePaths, icon: iconPath, mode: "copy" };
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
 * Starts a native OS drag of one or more sample files. Unlike an HTML5 drag
 * from the webview, this is recognized by native apps (Finder, Logic, …) as a
 * real file drag. Never throws — outside Tauri (or if the drag can't begin) it
 * simply no-ops. `onEnd` runs when the drag finishes (dropped or cancelled).
 */
export async function startSampleDrag(
  filePaths: string[],
  onEnd?: () => void,
): Promise<void> {
  if (filePaths.length === 0) return;
  exporting = true;
  const finish = () => {
    exporting = false;
    onEnd?.();
  };
  try {
    const icon = await dragIconPath();
    await startDrag(dragOptionsForSamples(filePaths, icon), finish);
  } catch {
    finish();
  }
}
