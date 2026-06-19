import { describe, expect, it } from "vitest";
import type { Sample } from "../types/sample";
import {
  exactDuplicateGroups,
  formatConfidence,
  nearDuplicateGroups,
} from "./analysis";

const sample = (patch: Partial<Sample>): Sample => ({
  id: patch.id ?? 1,
  name: patch.name ?? "sample",
  file_path: patch.file_path ?? `/tmp/${patch.id ?? 1}.wav`,
  tags: [],
  is_favorite: false,
  created_at: "2026-06-18T00:00:00Z",
  updated_at: "2026-06-18T00:00:00Z",
  ...patch,
});

describe("exactDuplicateGroups", () => {
  it("groups only samples that share a content hash", () => {
    const groups = exactDuplicateGroups([
      sample({ id: 1, content_hash: "aaa" }),
      sample({ id: 2, content_hash: "bbb" }),
      sample({ id: 3, content_hash: "aaa" }),
      sample({ id: 4 }),
    ]);

    expect(groups).toEqual([[1, 3]]);
  });

  it("ignores singletons and error-only hash rows", () => {
    const groups = exactDuplicateGroups([
      sample({ id: 1, content_hash: "aaa", hash_status: "ok" }),
      sample({ id: 2, hash_status: "error" }),
    ]);

    expect(groups).toEqual([]);
  });
});

describe("nearDuplicateGroups", () => {
  it("groups samples with the same non-empty audio fingerprint", () => {
    const groups = nearDuplicateGroups([
      sample({ id: 1, audio_fingerprint: "120|Am|0102" }),
      sample({ id: 2, audio_fingerprint: "120|Am|0102" }),
      sample({ id: 3, audio_fingerprint: "122|Am|0102" }),
    ]);

    expect(groups).toEqual([[1, 2]]);
  });
});

describe("formatConfidence", () => {
  it("formats bounded confidence values as whole percentages", () => {
    expect(formatConfidence(0.624)).toBe("62%");
    expect(formatConfidence(1.2)).toBe("100%");
    expect(formatConfidence(-0.1)).toBe("0%");
  });

  it("returns an em dash for unknown confidence", () => {
    expect(formatConfidence(undefined)).toBe("-");
    expect(formatConfidence(null)).toBe("-");
  });
});
