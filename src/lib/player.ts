/** Pure helpers for the audio player, extracted so they're unit-testable
 * without pulling the React component / wavesurfer / DOM into the test. */

export const VOLUME_STORAGE_KEY = "sample-tracker:volume";

/** Seconds → "m:ss". Non-finite or negative input renders as "0:00". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parse a persisted volume string into a 0..1 value, defaulting to 1.0. */
export function parseVolume(raw: string | null): number {
  if (raw == null) return 1;
  const v = Number.parseFloat(raw);
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/**
 * Whether the global Space playback shortcut should defer to the focused UI
 * element's native interaction. Accepts a narrow structural shape so it stays
 * unit-testable without a DOM environment.
 */
export function shouldIgnoreGlobalPlaybackShortcut(
  target:
    | {
        tagName?: string;
        type?: string;
        isContentEditable?: boolean;
      }
    | null,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") {
    return true;
  }

  return false;
}

/** Hz → "44.1 kHz" (trailing zeros trimmed). "" for missing/invalid input. */
export function formatSampleRate(hz: number | null | undefined): string {
  if (hz == null || !Number.isFinite(hz) || hz <= 0) return "";
  return `${parseFloat((hz / 1000).toFixed(3))} kHz`;
}

/** Channel count → "mono" / "stereo" / "N ch". "" for missing/invalid input. */
export function formatChannels(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  if (n === 1) return "mono";
  if (n === 2) return "stereo";
  return `${n} ch`;
}
