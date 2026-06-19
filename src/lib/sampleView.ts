import type { Sample } from "../types/sample";
import { formatChannels, formatSampleRate, formatTime } from "./player";

export type SampleDraft = {
  name: string;
  type: string;
  bpm: string;
  musical_key: string;
  mood: string;
  source: string;
  notes: string;
  tags: string[];
};

export type SampleFilters = {
  type: string;
  tag: string;
  key: string;
  mood: string;
  bpmMin: string;
  bpmMax: string;
};

export function draftFromSample(s: Sample): SampleDraft {
  return {
    name: s.name,
    type: s.type ?? "",
    bpm: s.bpm != null ? String(s.bpm) : "",
    musical_key: s.musical_key ?? "",
    mood: s.mood ?? "",
    source: s.source ?? "",
    notes: s.notes ?? "",
    tags: s.tags,
  };
}

export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((tag, i) => tag === y[i]);
}

export function draftsEqual(a: SampleDraft, b: SampleDraft): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.bpm === b.bpm &&
    a.musical_key === b.musical_key &&
    a.mood === b.mood &&
    a.source === b.source &&
    a.notes === b.notes &&
    sameTags(a.tags, b.tags)
  );
}

export function validateBpmInput(
  rawValue: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const raw = rawValue.trim();
  if (raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 1000) {
    return {
      ok: false,
      error: "BPM must be a whole number between 0 and 1000.",
    };
  }
  return { ok: true, value: n };
}

export function audioSummary(sample: Sample): string {
  return [
    sample.duration_seconds != null ? formatTime(sample.duration_seconds) : "",
    formatSampleRate(sample.sample_rate),
    formatChannels(sample.channels),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function deriveFilterOptions(samples: Sample[]): {
  keys: string[];
  moods: string[];
} {
  return {
    keys: Array.from(
      new Set(samples.map((s) => s.musical_key).filter(Boolean) as string[]),
    ).sort(),
    moods: Array.from(
      new Set(samples.map((s) => s.mood).filter(Boolean) as string[]),
    ).sort(),
  };
}

export function filterSamples(
  samples: Sample[],
  {
    search,
    filters,
    onlyMissing,
    onlyFavorites,
    missingIds,
  }: {
    search: string;
    filters: SampleFilters;
    onlyMissing: boolean;
    onlyFavorites: boolean;
    missingIds: Set<number>;
  },
): Sample[] {
  const q = search.trim().toLowerCase();
  const min = filters.bpmMin ? Number(filters.bpmMin) : null;
  const max = filters.bpmMax ? Number(filters.bpmMax) : null;

  return samples.filter((s) => {
    if (onlyMissing && !missingIds.has(s.id)) return false;
    if (onlyFavorites && !s.is_favorite) return false;
    if (filters.type && s.type !== filters.type) return false;
    if (filters.tag && !s.tags.includes(filters.tag)) return false;
    if (filters.key && s.musical_key !== filters.key) return false;
    if (filters.mood && (s.mood ?? "") !== filters.mood) return false;
    if (min != null && (s.bpm == null || s.bpm < min)) return false;
    if (max != null && (s.bpm == null || s.bpm > max)) return false;

    if (q) {
      const haystack = [
        s.name,
        s.type,
        s.mood,
        s.musical_key,
        s.notes,
        s.source,
        s.original_filename,
        ...s.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
