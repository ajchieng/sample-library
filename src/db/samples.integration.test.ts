import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: number;
  name: string;
  original_filename: string | null;
  file_path: string;
  original_path: string | null;
  bpm: number | null;
  musical_key: string | null;
  type: string | null;
  mood: string | null;
  source: string | null;
  notes: string | null;
  is_favorite: number | null;
  duration_seconds: number | null;
  sample_rate: number | null;
  channels: number | null;
  created_at: string;
  updated_at: string;
};

type Tag = { id: number; name: string };

type Join = { sample_id: number; tag_id: number };

class FakeDb {
  samples: Row[] = [];
  tags: Tag[] = [];
  sampleTags: Join[] = [];
  executeLog: string[] = [];
  nextSampleId = 1;
  nextTagId = 1;

  async execute(sql: string, params: unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.executeLog.push(normalized);

    if (normalized.startsWith("INSERT INTO samples")) {
      const filePath = params[2] as string;
      const originalPath = (params[3] as string | null) ?? null;
      // Mirror the real schema: file_path and original_path are both UNIQUE.
      // Duplicate detection now keys off original_path (the import source), since
      // every managed file_path is unique by construction.
      if (
        this.samples.some(
          (s) =>
            s.file_path === filePath ||
            (originalPath != null && s.original_path === originalPath),
        )
      ) {
        throw new Error("UNIQUE constraint failed: samples.original_path");
      }
      const id = this.nextSampleId++;
      this.samples.push({
        id,
        name: params[0] as string,
        original_filename: params[1] as string,
        file_path: filePath,
        original_path: originalPath,
        bpm: null,
        musical_key: null,
        type: null,
        mood: null,
        source: (params[4] as string | null) ?? null,
        notes: null,
        is_favorite: 0,
        duration_seconds: null,
        sample_rate: null,
        channels: null,
        created_at: `2026-01-01T00:00:0${id}`,
        updated_at: `2026-01-01T00:00:0${id}`,
      });
      return { lastInsertId: id };
    }

    if (normalized.startsWith("UPDATE samples SET file_path")) {
      const [filePath, originalPath, originalFilename, id] = params as [
        string,
        string,
        string,
        number,
      ];
      if (
        this.samples.some(
          (s) =>
            s.id !== id &&
            (s.file_path === filePath || s.original_path === originalPath),
        )
      ) {
        throw new Error("UNIQUE constraint failed: samples.original_path");
      }
      const sample = this.samples.find((s) => s.id === id);
      if (sample) {
        sample.file_path = filePath;
        sample.original_path = originalPath;
        sample.original_filename = originalFilename;
      }
      return { rowsAffected: sample ? 1 : 0 };
    }

    if (normalized.startsWith("INSERT OR IGNORE INTO tags")) {
      const name = params[0] as string;
      if (!this.tags.some((t) => t.name === name)) {
        this.tags.push({ id: this.nextTagId++, name });
      }
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT OR IGNORE INTO sample_tags")) {
      const [sampleId, name] = params as [number, string];
      const tag = this.tags.find((t) => t.name === name);
      if (
        tag &&
        !this.sampleTags.some(
          (j) => j.sample_id === sampleId && j.tag_id === tag.id,
        )
      ) {
        this.sampleTags.push({ sample_id: sampleId, tag_id: tag.id });
      }
      return { rowsAffected: tag ? 1 : 0 };
    }

    if (
      normalized.startsWith(
        "DELETE FROM sample_tags WHERE sample_id = $1 AND tag_id NOT IN",
      )
    ) {
      const [sampleId, ...names] = params as [number, ...string[]];
      const keep = new Set(
        this.tags.filter((t) => names.includes(t.name)).map((t) => t.id),
      );
      this.sampleTags = this.sampleTags.filter(
        (j) => j.sample_id !== sampleId || keep.has(j.tag_id),
      );
      return { rowsAffected: 1 };
    }

    if (normalized === "DELETE FROM sample_tags WHERE sample_id = $1") {
      const [sampleId] = params as [number];
      this.sampleTags = this.sampleTags.filter((j) => j.sample_id !== sampleId);
      return { rowsAffected: 1 };
    }

    throw new Error(`Unhandled SQL: ${normalized}`);
  }

  async select<T>(sql: string): Promise<T> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT s.*")) {
      return this.samples.map((sample) => {
        const tagCsv = this.sampleTags
          .filter((join) => join.sample_id === sample.id)
          .map((join) => this.tags.find((tag) => tag.id === join.tag_id)?.name)
          .filter(Boolean)
          .join("\x1f");
        return { ...sample, tag_csv: tagCsv || null };
      }) as T;
    }

    throw new Error(`Unhandled SQL: ${normalized}`);
  }
}

const testState = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("./schema", () => ({
  getDb: async () => testState.db,
}));

describe("sample repository behavior", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = new FakeDb();
    testState.db = db;
  });

  it("detects duplicate imports by source path", async () => {
    const { createSample, DuplicateSampleError } = await import("./samples");

    await createSample({
      name: "kick",
      original_filename: "kick.wav",
      file_path: "/Library/Uncategorized/kick.wav",
      original_path: "/Samples/kick.wav",
    });

    // Re-importing the same source gets a fresh managed file_path, so the clash
    // is on original_path — it must still be flagged as already in the library.
    await expect(
      createSample({
        name: "kick again",
        original_filename: "kick.wav",
        file_path: "/Library/Uncategorized/kick (2).wav",
        original_path: "/Samples/kick.wav",
      }),
    ).rejects.toBeInstanceOf(DuplicateSampleError);
  });

  it("relinking rejects paths already attached to another sample", async () => {
    const { createSample, DuplicateSampleError, relinkSample } =
      await import("./samples");
    const first = await createSample({
      name: "kick",
      original_filename: "kick.wav",
      file_path: "/Library/Uncategorized/kick.wav",
      original_path: "/Samples/kick.wav",
    });
    await createSample({
      name: "snare",
      original_filename: "snare.wav",
      file_path: "/Library/Uncategorized/snare.wav",
      original_path: "/Samples/snare.wav",
    });

    await expect(
      relinkSample(
        first,
        "/Library/Uncategorized/snare.wav",
        "/Samples/snare.wav",
        "snare.wav",
      ),
    ).rejects.toBeInstanceOf(DuplicateSampleError);
  });

  it("round-trips tags containing commas through listSamples", async () => {
    const { createSample, listSamples } = await import("./samples");
    const id = await createSample({
      name: "loop",
      original_filename: "loop.wav",
      file_path: "/Library/Uncategorized/loop.wav",
      original_path: "/Samples/loop.wav",
    });
    db.tags.push(
      { id: db.nextTagId++, name: "jazz, soul" },
      { id: db.nextTagId++, name: "drums" },
    );
    db.sampleTags.push(
      { sample_id: id, tag_id: db.tags[0].id },
      { sample_id: id, tag_id: db.tags[1].id },
    );

    const samples = await listSamples();

    expect(samples[0]?.tags).toEqual(["drums", "jazz, soul"]);
  });

  it("adds tags to existing samples without removing current tags", async () => {
    const { addTagsToSamples, createSample, listSamples } =
      await import("./samples");
    const id = await createSample({
      name: "drumbeat",
      original_filename: "drumbeat.wav",
      file_path: "/Library/Uncategorized/drumbeat.wav",
      original_path: "/Samples/drumbeat.wav",
      tags: ["favorite"],
    });

    await addTagsToSamples([{ id, tags: ["beat", "drum", "beat"] }]);

    const samples = await listSamples();
    expect(samples[0]?.tags).toEqual(["beat", "drum", "favorite"]);
  });
});
