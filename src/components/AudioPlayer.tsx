import { useEffect, useRef, useState } from "react";
import { Play, Pause, Repeat, Volume2, VolumeX } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import type { Sample } from "../types/sample";
import {
  FILE_MISSING_MESSAGE,
  FORMAT_UNSUPPORTED_MESSAGE,
  toAudioSrc,
} from "../lib/audio";
import { pathExists } from "../lib/files";
import {
  formatTime,
  parseVolume,
  shouldIgnoreGlobalPlaybackShortcut,
  VOLUME_STORAGE_KEY,
} from "../lib/player";

type Props = {
  sample: Sample | null;
  onError: (message: string) => void;
};

/** Reads the persisted volume (0..1), falling back to 1.0 (100%). */
function readStoredVolume(): number {
  try {
    return parseVolume(localStorage.getItem(VOLUME_STORAGE_KEY));
  } catch {
    return 1;
  }
}

export function AudioPlayer({ sample, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  // Refs let the (create-once) WaveSurfer event handlers read the latest props
  // without having to re-subscribe on every render.
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [volume, setVolume] = useState<number>(() => readStoredVolume());
  const [loop, setLoop] = useState(false);

  // The create-once WaveSurfer effect needs the latest volume at creation time
  // without re-subscribing, so mirror it into a ref.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Build the WaveSurfer instance once and wire it to the persistent container.
  // It renders a real waveform from the decoded audio and owns click/drag
  // seeking, replacing the previous fake bars + manual seek handler.
  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 40,
      waveColor: "#2b3847",
      progressColor: "#20b6aa",
      cursorColor: "rgba(237, 243, 248, 0.58)",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
    });
    wsRef.current = ws;
    ws.setVolume(volumeRef.current);

    const handleError = async () => {
      setIsPlaying(false);
      const s = sampleRef.current;
      if (!s) return;
      // Distinguish "moved/deleted" from "format the webview can't decode".
      const exists = await pathExists(s.file_path).catch(() => false);
      const message = exists
        ? FORMAT_UNSUPPORTED_MESSAGE
        : FILE_MISSING_MESSAGE;
      setLocalError(message);
      onErrorRef.current(message);
    };

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => {
      setIsPlaying(false);
      ws.seekTo(0);
      setCurrentTime(0);
    });
    ws.on("ready", () => setDuration(ws.getDuration()));
    ws.on("timeupdate", (time) => setCurrentTime(time));
    ws.on("error", (err) => {
      // Switching samples aborts the in-flight load — not a real error.
      if (err instanceof Error && err.name === "AbortError") return;
      void handleError();
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, []);

  // Load the new source whenever the selected sample changes.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    setLocalError(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    // Re-evaluate the loop default for each newly selected sample: loops default
    // to looping, everything else off. The user can still toggle afterwards.
    setLoop(sample?.type === "loop");
    if (sample) {
      // Real failures (incl. unsupported codecs) surface via the "error" event,
      // which also filters AbortError; swallow the promise to avoid noise.
      ws.load(toAudioSrc(sample.file_path)).catch(() => {});
    } else {
      ws.empty();
    }
    // Intentionally keyed on identity (id + path), not the whole `sample`, so
    // editing metadata (e.g. type) doesn't reload/restart the audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample?.id, sample?.file_path]);

  const togglePlay = () => {
    if (!sampleRef.current) return;
    wsRef.current?.playPause();
  };

  // Spacebar toggles playback unless the user is typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || shouldIgnoreGlobalPlaybackShortcut(target)) {
        return;
      }
      if (!sampleRef.current) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Apply + persist the volume whenever it changes.
  useEffect(() => {
    wsRef.current?.setVolume(volume);
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // Ignore storage failures (e.g. private mode); volume still applies.
    }
  }, [volume]);

  // Drive looping via the native media element's `loop` property so it repeats
  // gaplessly. Re-applied when the loop state OR the selected sample changes
  // (a fresh load can swap the underlying media element).
  useEffect(() => {
    const media = wsRef.current?.getMediaElement();
    if (media) media.loop = loop;
  }, [loop, sample?.id, sample?.file_path]);

  return (
    <footer className="player">
      <button
        type="button"
        className="player-play"
        onClick={togglePlay}
        disabled={!sample}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>

      <div className="player-meta">
        <div className="player-name">
          {sample ? sample.name : "No sample selected"}
        </div>
        <div className="player-sub">
          {localError ? (
            <span className="player-error">{localError}</span>
          ) : sample?.source ? (
            sample.source
          ) : (
            "Select a sample, then press space to play"
          )}
        </div>
      </div>

      <div className="waveform" ref={containerRef} />

      <div className="player-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      <div className="player-controls">
        <button
          type="button"
          className={`player-loop${loop ? " active" : ""}`}
          onClick={() => setLoop((v) => !v)}
          disabled={!sample}
          aria-pressed={loop}
          aria-label={loop ? "Disable loop" : "Enable loop"}
          title={loop ? "Looping on" : "Looping off"}
        >
          <Repeat size={16} />
        </button>

        <div className="player-volume">
          {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            aria-label="Volume"
            title={`Volume ${Math.round(volume * 100)}%`}
          />
        </div>
      </div>

      {sample?.bpm != null ? (
        <div className="player-bpm">{sample.bpm} BPM</div>
      ) : null}
    </footer>
  );
}
