import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { Sample } from "../types/sample";
import {
  FILE_MISSING_MESSAGE,
  FORMAT_UNSUPPORTED_MESSAGE,
  toAudioSrc,
} from "../lib/audio";
import { pathExists } from "../lib/files";

type Props = {
  sample: Sample | null;
  onError: (message: string) => void;
};

/** Deterministic pseudo-random bar heights so the waveform looks stable. */
function makeBars(seed: number, count = 56): number[] {
  const bars: number[] = [];
  let x = seed * 9301 + 49297;
  for (let i = 0; i < count; i++) {
    x = (x * 9301 + 49297) % 233280;
    const r = x / 233280;
    bars.push(0.2 + r * 0.8);
  }
  return bars;
}

export function AudioPlayer({ sample, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const bars = useMemo(() => makeBars(sample?.id ?? 1), [sample?.id]);

  // Load the new source whenever the selected sample changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setLocalError(null);
    setProgress(0);
    setIsPlaying(false);
    if (sample) {
      audio.src = toAudioSrc(sample.file_path);
      audio.load();
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
  }, [sample?.id, sample?.file_path]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !sample) return;
    if (audio.paused) {
      void audio.play().catch(() => void handleError());
    } else {
      audio.pause();
    }
  };

  const handleError = async () => {
    setIsPlaying(false);
    if (!sample) return;
    // Distinguish "moved/deleted" from "format the webview can't decode".
    const exists = await pathExists(sample.file_path).catch(() => false);
    const message = exists ? FORMAT_UNSUPPORTED_MESSAGE : FILE_MISSING_MESSAGE;
    setLocalError(message);
    onError(message);
  };

  // Spacebar toggles playback unless the user is typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!sample) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sample?.id]);

  const playedBars = Math.floor(progress * bars.length);

  return (
    <footer className="player">
      <button
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

      <div
        className="waveform"
        onClick={(e) => {
          const audio = audioRef.current;
          if (!audio || !sample || !audio.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          audio.currentTime = ratio * audio.duration;
        }}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className={i <= playedBars ? "bar bar-played" : "bar"}
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        ))}
      </div>

      {sample?.bpm != null ? (
        <div className="player-bpm">{sample.bpm} BPM</div>
      ) : null}

      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
        onError={() => void handleError()}
      />
    </footer>
  );
}
