import { describe, expect, it } from "vitest";
import type { Sample } from "../types/sample";
import {
  audioSummary,
  deriveFilterOptions,
  draftFromSample,
  draftsEqual,
  filterSamples,
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
    expect(draftFromSample({ ...baseSample, bpm: undefined, mood: undefined })).toMatchObject({
      name: "Dusty Kick",
      bpm: "",
      mood: "",
      tags: ["kick", "drums"],
    });
  });

  it("compares drafts with order-insensitive tags", () => {
    const draft = draftFromSample(baseSample);
    expect(draftsEqual(draft, { ...draft, tags: ["drums", "kick"] })).toBe(true);
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
});
