import { describe, expect, it } from "vitest";
import type { Sample } from "../types/sample";
import { autoTagsForFilename, buildAutoTagPlan } from "./autoTags";

describe("autoTagsForFilename", () => {
  it("tags beat files from the filename", () => {
    expect(autoTagsForFilename("/samples/soul-beat-92bpm.wav")).toEqual([
      "beat",
    ]);
  });

  it("tags drum files from drum-related filename keywords", () => {
    expect(autoTagsForFilename("/samples/kick-loop.wav")).toEqual(["drum"]);
    expect(autoTagsForFilename("/samples/snare_take.aiff")).toEqual(["drum"]);
    expect(autoTagsForFilename("/samples/open_hat_01.m4a")).toEqual(["drum"]);
    expect(autoTagsForFilename("/samples/crash.wav")).toEqual(["drum"]);
  });

  it("can tag a filename as both beat and drum", () => {
    expect(autoTagsForFilename("/samples/drumbeat.m4a")).toEqual([
      "beat",
      "drum",
    ]);
  });

  it("returns no tags when no rule matches", () => {
    expect(autoTagsForFilename("/samples/piano-chord.flac")).toEqual([]);
  });
});

const baseSample: Sample = {
  id: 1,
  name: "Sample",
  original_filename: "sample.wav",
  file_path: "/Library/sample.wav",
  tags: [],
  is_favorite: false,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("buildAutoTagPlan", () => {
  it("plans only missing filename-derived tags", () => {
    const plan = buildAutoTagPlan([
      {
        ...baseSample,
        id: 1,
        name: "Beat",
        original_filename: "soul-beat.wav",
      },
      {
        ...baseSample,
        id: 2,
        name: "Kick",
        original_filename: "kick-loop.wav",
        tags: ["drum"],
      },
      {
        ...baseSample,
        id: 3,
        name: "Drumbeat",
        original_filename: "drumbeat.m4a",
        tags: ["beat"],
      },
    ]);

    expect(plan).toEqual({
      items: [
        {
          sampleId: 1,
          name: "Beat",
          filename: "soul-beat.wav",
          tagsToAdd: ["beat"],
        },
        {
          sampleId: 3,
          name: "Drumbeat",
          filename: "drumbeat.m4a",
          tagsToAdd: ["drum"],
        },
      ],
      tagCounts: { beat: 1, drum: 1 },
      sampleCount: 2,
      tagAddCount: 2,
    });
  });
});
