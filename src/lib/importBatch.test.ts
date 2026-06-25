import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the database layer entirely so no Tauri SQL plugin is loaded. The
// DuplicateSampleError class defined here is the same one importBatch imports,
// so `instanceof` checks line up.
vi.mock("../db/samples", () => {
  class DuplicateSampleError extends Error {}
  return { createSample: vi.fn(), DuplicateSampleError };
});

// Keep the pure path helpers real; only stub the IPC-backed functions.
vi.mock("./files", async (importActual) => {
  const actual = await importActual<typeof import("./files")>();
  return {
    ...actual,
    importToLibrary: vi.fn(),
    deleteLibraryFile: vi.fn(),
    unmanagedPaths: vi.fn(),
  };
});

import { importPaths, type ImportBatchDeps } from "./importBatch";
import { createSample, DuplicateSampleError } from "../db/samples";
import { deleteLibraryFile, importToLibrary, unmanagedPaths } from "./files";

const mockCreate = vi.mocked(createSample);
const mockImport = vi.mocked(importToLibrary);
const mockDelete = vi.mocked(deleteLibraryFile);
const mockUnmanaged = vi.mocked(unmanagedPaths);

function makeDeps(overrides: Partial<ImportBatchDeps> = {}): ImportBatchDeps {
  return {
    reload: vi.fn().mockResolvedValue(undefined),
    scanMetadata: vi.fn().mockResolvedValue(undefined),
    scanHashes: vi.fn().mockResolvedValue(undefined),
    scanAnalysis: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // By default every supported path is external (not yet in the library).
  mockUnmanaged.mockImplementation(async (paths) => new Set(paths));
  // The managed copy lands under /lib/ with the same filename.
  mockImport.mockImplementation(async (src) => `/lib/${src.split("/").pop()}`);
  let nextId = 1;
  mockCreate.mockImplementation(async () => nextId++);
  mockDelete.mockResolvedValue(undefined);
});

describe("importPaths", () => {
  it("copies and inserts each new supported file", async () => {
    const deps = makeDeps();
    const result = await importPaths(["/a/kick.wav", "/a/snare.wav"], deps);

    expect(result).toMatchObject({
      added: 2,
      inLibrary: 0,
      failed: 0,
      unsupported: 0,
      lastId: 2,
    });
    expect(mockImport).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tags: [] }),
    );
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.scanMetadata).toHaveBeenCalledWith([
      "/lib/kick.wav",
      "/lib/snare.wav",
    ]);
  });

  it("skips files already imported via knownOriginalPaths", async () => {
    const deps = makeDeps();
    const result = await importPaths(["/a/kick.wav", "/a/snare.wav"], {
      ...deps,
      knownOriginalPaths: new Set(["/a/kick.wav"]),
    });

    expect(result).toMatchObject({ added: 1, inLibrary: 1 });
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport).toHaveBeenCalledWith("/a/snare.wav", "");
  });

  it("counts unsupported (non-audio) inputs", async () => {
    const result = await importPaths(
      ["/a/kick.wav", "/a/notes.txt"],
      makeDeps(),
    );
    expect(result).toMatchObject({ added: 1, unsupported: 1 });
  });

  it("adds filename-derived tags when auto-tag is enabled", async () => {
    await importPaths(
      ["/a/soul-beat.wav", "/a/kick_loop.wav", "/a/drumbeat.m4a"],
      makeDeps({ autoTag: true }),
    );

    expect(mockCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tags: ["beat"] }),
    );
    expect(mockCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tags: ["drum"] }),
    );
    expect(mockCreate).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ tags: ["beat", "drum"] }),
    );
  });

  it("rolls back the managed copy when the insert is a duplicate", async () => {
    mockCreate.mockRejectedValueOnce(new DuplicateSampleError("dup"));
    const deps = makeDeps();
    const result = await importPaths(["/a/kick.wav"], deps);

    expect(result).toMatchObject({ added: 0, inLibrary: 1, failed: 0 });
    expect(mockDelete).toHaveBeenCalledWith("/lib/kick.wav");
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("reports a failure (and cleans up) when the copy succeeds but insert errors", async () => {
    mockCreate.mockRejectedValueOnce(new Error("disk full"));
    const result = await importPaths(["/a/kick.wav"], makeDeps());

    expect(result).toMatchObject({ added: 0, failed: 1 });
    expect(mockDelete).toHaveBeenCalledWith("/lib/kick.wav");
  });

  it("fires onProgress for each processed file", async () => {
    const onProgress = vi.fn();
    await importPaths(
      ["/a/kick.wav", "/a/snare.wav"],
      makeDeps({ onProgress }),
    );

    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });
});
