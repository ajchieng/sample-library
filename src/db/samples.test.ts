import { describe, expect, it } from "vitest";
import { normalizeTags, toFavorite } from "./samples";

describe("toFavorite", () => {
  it("maps the stored integer 1 to true", () => {
    expect(toFavorite(1)).toBe(true);
  });

  it("maps 0, null, and undefined to false", () => {
    expect(toFavorite(0)).toBe(false);
    expect(toFavorite(null)).toBe(false);
    expect(toFavorite(undefined)).toBe(false);
  });

  it("treats unexpected non-1 integers as not-favorite", () => {
    expect(toFavorite(2)).toBe(false);
  });
});

describe("normalizeTags", () => {
  it("trims, lowercases, drops blanks, and de-duplicates tags", () => {
    expect(normalizeTags([" Kick ", "kick", "", "SNARE", "  "])).toEqual([
      "kick",
      "snare",
    ]);
  });

  it("preserves first-seen order after normalization", () => {
    expect(normalizeTags(["B", "a", "b", "C"])).toEqual(["b", "a", "c"]);
  });
});
