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

export const EMPTY_FILTERS: SampleFilters = {
  type: "",
  tag: "",
  key: "",
  mood: "",
  bpmMin: "",
  bpmMax: "",
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

/**
 * Lowercased, concatenated searchable text for a sample, cached by object
 * identity. Building this blob is the per-row cost of search; caching it keeps
 * filtering cheap across large libraries because only changed rows (which get a
 * fresh object via setSamples) recompute — unchanged rows hit the cache. A
 * WeakMap means entries are reclaimed when the sample object is GC'd.
 */
const searchBlobCache = new WeakMap<Sample, string>();

export function searchBlob(s: Sample): string {
  const cached = searchBlobCache.get(s);
  if (cached !== undefined) return cached;
  const blob = [
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
  searchBlobCache.set(s, blob);
  return blob;
}

type ParsedSearchQuery = {
  text: string;
  type: string;
  tags: string[];
  key: string;
  mood: string;
  bpmMin: number | null;
  bpmMax: number | null;
  onlyFavorites: boolean;
  onlyMissing: boolean;
};

function parseSearchQuery(rawSearch: string): ParsedSearchQuery {
  const parsed: ParsedSearchQuery = {
    text: "",
    type: "",
    tags: [],
    key: "",
    mood: "",
    bpmMin: null,
    bpmMax: null,
    onlyFavorites: false,
    onlyMissing: false,
  };
  const textTerms: string[] = [];

  for (const rawPart of rawSearch.trim().split(/\s+/)) {
    if (!rawPart) continue;
    const part = rawPart.toLowerCase();
    if (part === "fav" || part === "favorite" || part === "favorites") {
      parsed.onlyFavorites = true;
      continue;
    }
    if (part === "missing") {
      parsed.onlyMissing = true;
      continue;
    }

    const colon = part.indexOf(":");
    if (colon === -1) {
      textTerms.push(rawPart);
      continue;
    }

    const key = part.slice(0, colon);
    const value = part.slice(colon + 1).trim();
    if (!value) {
      textTerms.push(rawPart);
      continue;
    }

    if (key === "tag") {
      parsed.tags.push(value);
    } else if (key === "type") {
      parsed.type = value;
    } else if (key === "key") {
      parsed.key = value;
    } else if (key === "mood") {
      parsed.mood = value;
    } else if (key === "bpm") {
      const [minRaw, maxRaw] = value.split("-", 2);
      const min = Number(minRaw);
      const max = maxRaw === undefined || maxRaw === "" ? min : Number(maxRaw);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        parsed.bpmMin = Math.min(min, max);
        parsed.bpmMax = Math.max(min, max);
      } else {
        textTerms.push(rawPart);
      }
    } else {
      textTerms.push(rawPart);
    }
  }

  parsed.text = textTerms.join(" ").trim().toLowerCase();
  return parsed;
}

function lower(value: string | undefined): string {
  return (value ?? "").toLowerCase();
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
  const query = parseSearchQuery(search);
  const min = filters.bpmMin ? Number(filters.bpmMin) : null;
  const max = filters.bpmMax ? Number(filters.bpmMax) : null;

  return samples.filter((s) => {
    if ((onlyMissing || query.onlyMissing) && !missingIds.has(s.id)) {
      return false;
    }
    if ((onlyFavorites || query.onlyFavorites) && !s.is_favorite) return false;
    if (filters.type && s.type !== filters.type) return false;
    if (query.type && lower(s.type) !== query.type) return false;
    if (filters.tag && !s.tags.includes(filters.tag)) return false;
    if (
      query.tags.some(
        (tag) => !s.tags.some((sampleTag) => lower(sampleTag) === tag),
      )
    ) {
      return false;
    }
    if (filters.key && s.musical_key !== filters.key) return false;
    if (query.key && lower(s.musical_key) !== query.key) return false;
    if (filters.mood && (s.mood ?? "") !== filters.mood) return false;
    if (query.mood && lower(s.mood) !== query.mood) return false;
    if (min != null && (s.bpm == null || s.bpm < min)) return false;
    if (max != null && (s.bpm == null || s.bpm > max)) return false;
    if (query.bpmMin != null && (s.bpm == null || s.bpm < query.bpmMin)) {
      return false;
    }
    if (query.bpmMax != null && (s.bpm == null || s.bpm > query.bpmMax)) {
      return false;
    }

    if (query.text && !searchBlob(s).includes(query.text)) return false;
    return true;
  });
}

// ---- Sorting ---------------------------------------------------------------

export type SortKey = "name" | "type" | "bpm" | "musical_key" | "created_at";
export type SortDir = "asc" | "desc";
export type SampleSort = { key: SortKey; dir: SortDir };

/** Newest-first, matching the order `listSamples` already returns rows in. */
export const DEFAULT_SORT: SampleSort = { key: "created_at", dir: "desc" };

const NUMERIC_KEYS = new Set<SortKey>(["bpm"]);

/**
 * Returns a new array sorted by the given key/direction. Pure (does not mutate
 * the input). Null/undefined values always sort last regardless of direction so
 * blank fields don't crowd the top. Sorts only whatever subset it's handed
 * (the already-filtered list), so it stays cheap.
 */
export function sortSamples(samples: Sample[], sort: SampleSort): Sample[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const numeric = NUMERIC_KEYS.has(sort.key);

  return [...samples].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const aEmpty = av == null || av === "";
    const bEmpty = bv == null || bv === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1; // nulls last, regardless of dir
    if (bEmpty) return -1;

    const cmp = numeric
      ? Number(av) - Number(bv)
      : String(av).localeCompare(String(bv), undefined, {
          sensitivity: "base",
          numeric: true,
        });
    return cmp * dir;
  });
}
