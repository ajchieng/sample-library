import { describe, expect, it } from "vitest";
import { dragOptionsForSample } from "./dragExport";

describe("dragOptionsForSample", () => {
  it("drags the file as a copy so the library original is never moved", () => {
    expect(dragOptionsForSample("/packs/kick.wav", "/res/icon.png")).toEqual({
      item: ["/packs/kick.wav"],
      icon: "/res/icon.png",
      mode: "copy",
    });
  });

  it("carries an empty icon path through unchanged", () => {
    expect(
      dragOptionsForSample("/Users/me/Drum Hits/kick 01.wav", ""),
    ).toEqual({
      item: ["/Users/me/Drum Hits/kick 01.wav"],
      icon: "",
      mode: "copy",
    });
  });
});
