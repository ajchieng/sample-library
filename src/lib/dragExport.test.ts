import { describe, expect, it } from "vitest";
import { dragOptionsForSamples } from "./dragExport";

describe("dragOptionsForSamples", () => {
  it("drags the file as a copy so the library original is never moved", () => {
    expect(dragOptionsForSamples(["/packs/kick.wav"], "/res/icon.png")).toEqual(
      {
        item: ["/packs/kick.wav"],
        icon: "/res/icon.png",
        mode: "copy",
      },
    );
  });

  it("carries an empty icon path through unchanged", () => {
    expect(
      dragOptionsForSamples(
        ["/Users/me/Drum Hits/kick 01.wav", "/Users/me/Drum Hits/snare 01.wav"],
        "",
      ),
    ).toEqual({
      item: [
        "/Users/me/Drum Hits/kick 01.wav",
        "/Users/me/Drum Hits/snare 01.wav",
      ],
      icon: "",
      mode: "copy",
    });
  });
});
