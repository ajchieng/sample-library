import { describe, expect, it } from "vitest";
import { diffFolderScan, pathIsUnder } from "./folderScan";

describe("pathIsUnder", () => {
  it("matches the folder itself and descendants, not siblings", () => {
    expect(pathIsUnder("/a/b", "/a/b")).toBe(true);
    expect(pathIsUnder("/a/b/c.wav", "/a/b")).toBe(true);
    expect(pathIsUnder("/a/b/sub/c.wav", "/a/b")).toBe(true);
    expect(pathIsUnder("/a/bc/c.wav", "/a/b")).toBe(false);
    expect(pathIsUnder("/other/c.wav", "/a/b")).toBe(false);
  });

  it("handles a trailing separator on the folder", () => {
    expect(pathIsUnder("/a/b/c.wav", "/a/b/")).toBe(true);
  });

  it("supports Windows-style separators", () => {
    expect(pathIsUnder("C:\\a\\b\\c.wav", "C:\\a\\b")).toBe(true);
    expect(pathIsUnder("C:\\a\\bc\\c.wav", "C:\\a\\b")).toBe(false);
  });
});

describe("diffFolderScan", () => {
  it("returns scanned files not yet imported as toImport", () => {
    const { toImport } = diffFolderScan({
      scannedPaths: ["/lib/a.wav", "/lib/b.wav", "/lib/c.wav"],
      knownOriginalPaths: ["/lib/b.wav"],
      watchedRoots: ["/lib"],
    });
    expect(toImport).toEqual(["/lib/a.wav", "/lib/c.wav"]);
  });

  it("de-duplicates repeated scanned paths in toImport", () => {
    const { toImport } = diffFolderScan({
      scannedPaths: ["/lib/a.wav", "/lib/a.wav"],
      knownOriginalPaths: [],
      watchedRoots: ["/lib"],
    });
    expect(toImport).toEqual(["/lib/a.wav"]);
  });

  it("reports known sources under a watched root that the scan no longer found", () => {
    const { removedAtSource } = diffFolderScan({
      scannedPaths: ["/lib/a.wav"],
      knownOriginalPaths: ["/lib/a.wav", "/lib/gone.wav"],
      watchedRoots: ["/lib"],
    });
    expect(removedAtSource).toEqual(["/lib/gone.wav"]);
  });

  it("never flags known sources outside the watched roots as removed", () => {
    const { removedAtSource } = diffFolderScan({
      scannedPaths: ["/lib/a.wav"],
      knownOriginalPaths: ["/elsewhere/picked.wav"],
      watchedRoots: ["/lib"],
    });
    expect(removedAtSource).toEqual([]);
  });
});
