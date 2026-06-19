import { describe, expect, it } from "vitest";
import {
  basename,
  extname,
  filenameWithoutExt,
  isSupportedAudio,
  parentFolderName,
} from "./files";

describe("path helpers", () => {
  it("basename handles both separators", () => {
    expect(basename("/a/b/kick.wav")).toBe("kick.wav");
    expect(basename("C:\\packs\\snare.aif")).toBe("snare.aif");
    expect(basename("loop.mp3")).toBe("loop.mp3");
  });

  it("extname returns the lower-cased extension without the dot", () => {
    expect(extname("/a/Kick.WAV")).toBe("wav");
    expect(extname("/a/no-extension")).toBe("");
    expect(extname("/a/.hidden")).toBe("");
  });

  it("filenameWithoutExt strips the trailing extension", () => {
    expect(filenameWithoutExt("kick.wav")).toBe("kick");
    expect(filenameWithoutExt("multi.part.flac")).toBe("multi.part");
    expect(filenameWithoutExt("noext")).toBe("noext");
  });

  it("parentFolderName returns the containing directory", () => {
    expect(parentFolderName("/Music/Drums/kick.wav")).toBe("Drums");
    expect(parentFolderName("kick.wav")).toBe("");
  });

  it("isSupportedAudio accepts known extensions only", () => {
    expect(isSupportedAudio("/a/kick.wav")).toBe(true);
    expect(isSupportedAudio("/a/track.OGG")).toBe(true);
    expect(isSupportedAudio("/a/notes.txt")).toBe(false);
  });
});
