import { describe, expect, it } from "vitest";
import { supportedDroppedPaths } from "./dragDrop";

describe("supportedDroppedPaths", () => {
  it("keeps supported audio paths and drops unsupported files", () => {
    expect(
      supportedDroppedPaths([
        "/packs/kick.wav",
        "/packs/readme.txt",
        "/packs/Loop.AIFF",
      ]),
    ).toEqual(["/packs/kick.wav", "/packs/Loop.AIFF"]);
  });

  it("de-duplicates exact paths while preserving order", () => {
    expect(
      supportedDroppedPaths([
        "/packs/kick.wav",
        "/packs/kick.wav",
        "/packs/snare.flac",
      ]),
    ).toEqual(["/packs/kick.wav", "/packs/snare.flac"]);
  });
});
