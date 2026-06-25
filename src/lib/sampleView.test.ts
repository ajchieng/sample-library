import { describe, expect, it } from "vitest";
import type { Sample } from "../types/sample";
import {
  audioSummary,
  deriveFilterOptions,
  draftFromSample,
  draftsEqual,
  filterSamples,
  searchBlob,
  sortSamples,
  validateBpmInput,
} from "./sampleView";

const baseSample: Sample = {
  id: 1,
  name: "Dusty Kick",
  original_filename: "dusty-kick.wav",
  file_path: "/Samples/Drums/dusty-kick.wav",
  bpm: 92,
  musical_key: "Am",
  type: "drum",
  mood: "dusty",
  source: "Drums",
  notes: "tight transient",
  tags: ["kick", "drums"],
  is_favorite: false,
  duration_seconds: 3.2,
  sample_rate: 44100,
  channels: 2,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("sample editor helpers", () => {
  it("builds a draft from nullable sample metadata", () => {
    expect(
      draftFromSample({ ...baseSample, bpm: undefined, mood: undefined }),
    ).toMatchObject({
      name: "Dusty Kick",
      bpm: "",
      mood: "",
      tags: ["kick", "drums"],
    });
  });

  it("compares drafts with order-insensitive tags", () => {
    const draft = draftFromSample(baseSample);
    expect(draftsEqual(draft, { ...draft, tags: ["drums", "kick"] })).toBe(
      true,
    );
    expect(draftsEqual(draft, { ...draft, tags: ["snare"] })).toBe(false);
  });

  it("validates BPM text into persisted values", () => {
    expect(validateBpmInput("")).toEqual({ ok: true, value: null });
    expect(validateBpmInput("128")).toEqual({ ok: true, value: 128 });
    expect(validateBpmInput("128.5")).toEqual({
      ok: false,
      error: "BPM must be a whole number between 0 and 1000.",
    });
  });
});

describe("sample display helpers", () => {
  it("formats audio metadata summaries with blanks omitted", () => {
    expect(audioSummary(baseSample)).toBe("0:03 · 44.1 kHz · stereo");
    expect(audioSummary({ ...baseSample, duration_seconds: undefined })).toBe(
      "44.1 kHz · stereo",
    );
  });

  it("derives sorted key and mood options", () => {
    expect(
      deriveFilterOptions([
        baseSample,
        { ...baseSample, id: 2, musical_key: "C", mood: "bright" },
        { ...baseSample, id: 3, musical_key: "Am", mood: undefined },
      ]),
    ).toEqual({ keys: ["Am", "C"], moods: ["bright", "dusty"] });
  });

  it("filters by missing, favorite, metadata fields, BPM range, and search text", () => {
    const samples = [
      baseSample,
      {
        ...baseSample,
        id: 2,
        name: "Warm Rhodes",
        type: "instrument" as const,
        bpm: 76,
        tags: ["keys"],
        is_favorite: true,
      },
    ];

    expect(
      filterSamples(samples, {
        search: "rhodes",
        filters: {
          type: "instrument",
          tag: "keys",
          key: "Am",
          mood: "dusty",
          bpmMin: "70",
          bpmMax: "80",
        },
        onlyMissing: false,
        onlyFavorites: true,
        missingIds: new Set(),
      }).map((sample) => sample.id),
    ).toEqual([2]);

    expect(
      filterSamples(samples, {
        search: "",
        filters: {
          type: "",
          tag: "",
          key: "",
          mood: "",
          bpmMin: "",
          bpmMax: "",
        },
        onlyMissing: true,
        onlyFavorites: false,
        missingIds: new Set([1]),
      }).map((sample) => sample.id),
    ).toEqual([1]);
  });

  it("matches search across every searchable field (incl. tags + filename)", () => {
    const opts = {
      filters: {
        type: "",
        tag: "",
        key: "",
        mood: "",
        bpmMin: "",
        bpmMax: "",
      },
      onlyMissing: false,
      onlyFavorites: false,
      missingIds: new Set<number>(),
    };
    const hit = (search: string) =>
      filterSamples([baseSample], { ...opts, search }).length === 1;

    expect(hit("DUSTY")).toBe(true); // case-insensitive, mood + name
    expect(hit("dusty-kick.wav")).toBe(true); // original filename
    expect(hit("drums")).toBe(true); // a tag
    expect(hit("nope")).toBe(false);
  });

  it("caches the search blob by sample identity and rebuilds on change", () => {
    const blob = searchBlob(baseSample);
    expect(blob).toContain("dusty kick");
    expect(searchBlob(baseSample)).toBe(blob); // same object → cached
    expect(searchBlob({ ...baseSample, name: "Bright Snare" })).toContain(
      "bright snare",
    ); // new object → recomputed
  });
});

describe("sortSamples", () => {
  const a = { ...baseSample, id: 1, name: "alpha", bpm: 120, musical_key: "C" };
  const b = { ...baseSample, id: 2, name: "Bravo", bpm: 90, musical_key: "Am" };
  const c = {
    ...baseSample,
    id: 3,
    name: "charlie",
    bpm: undefined,
    musical_key: "G",
  };
  const samples = [a, b, c];

  it("sorts text case-insensitively, both directions", () => {
    expect(
      sortSamples(samples, { key: "name", dir: "asc" }).map((s) => s.id),
    ).toEqual([1, 2, 3]);
    expect(
      sortSamples(samples, { key: "name", dir: "desc" }).map((s) => s.id),
    ).toEqual([3, 2, 1]);
  });

  it("sorts numeric fields numerically", () => {
    expect(
      sortSamples(samples, { key: "bpm", dir: "asc" }).map((s) => s.bpm),
    ).toEqual([90, 120, undefined]);
  });

  it("always sorts blank/null values last, regardless of direction", () => {
    const lastId = (dir: "asc" | "desc") => {
      const ids = sortSamples(samples, { key: "bpm", dir }).map((s) => s.id);
      return ids[ids.length - 1];
    };
    expect(lastId("asc")).toBe(3);
    expect(lastId("desc")).toBe(3);
  });

  it("returns a new array without mutating the input", () => {
    const input = [...samples];
    const out = sortSamples(input, { key: "name", dir: "asc" });
    expect(out).not.toBe(input);
    expect(input.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});
