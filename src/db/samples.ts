import { getDb } from "./schema";
import type { Sample, SampleMetadata, SampleType } from "../types/sample";

/** Raw row shape returned by the sample list query. */
type SampleRow = {
  id: number;
  name: string;
  original_filename: string | null;
  file_path: string;
  bpm: number | null;
  musical_key: string | null;
  type: string | null;
  mood: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  tag_csv: string | null;
};

/** Thrown when a file_path already exists in the library. */
export class DuplicateSampleError extends Error {
  constructor(public filePath: string) {
    super(`Sample already in library: ${filePath}`);
    this.name = "DuplicateSampleError";
  }
}

function rowToSample(row: SampleRow): Sample {
  return {
    id: row.id,
    name: row.name,
    original_filename: row.original_filename ?? undefined,
    file_path: row.file_path,
    bpm: row.bpm ?? undefined,
    musical_key: row.musical_key ?? undefined,
    type: (row.type as SampleType | null) ?? undefined,
    mood: row.mood ?? undefined,
    source: row.source ?? undefined,
    notes: row.notes ?? undefined,
    tags: row.tag_csv ? row.tag_csv.split(",").filter(Boolean).sort() : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** All samples with their tags, newest first. */
export async function listSamples(): Promise<Sample[]> {
  const db = await getDb();
  const rows = await db.select<SampleRow[]>(`
    SELECT
      s.*,
      GROUP_CONCAT(t.name) AS tag_csv
    FROM samples s
    LEFT JOIN sample_tags st ON st.sample_id = s.id
    LEFT JOIN tags t ON t.id = st.tag_id
    GROUP BY s.id
    ORDER BY s.created_at DESC, s.id DESC
  `);
  return rows.map(rowToSample);
}

/**
 * Inserts a new sample. The audio file itself is never touched — only the
 * path and metadata are stored. Throws DuplicateSampleError when the path is
 * already present.
 */
export async function createSample(input: {
  name: string;
  original_filename: string;
  file_path: string;
  source?: string;
}): Promise<number> {
  const db = await getDb();
  try {
    const res = await db.execute(
      `INSERT INTO samples (name, original_filename, file_path, source)
       VALUES ($1, $2, $3, $4)`,
      [input.name, input.original_filename, input.file_path, input.source ?? null],
    );
    return res.lastInsertId as number;
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      throw new DuplicateSampleError(input.file_path);
    }
    throw err;
  }
}

/** Updates editable metadata for a sample (never the file on disk). */
export async function updateSample(
  id: number,
  fields: SampleMetadata,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE samples
        SET name = $1,
            bpm = $2,
            musical_key = $3,
            type = $4,
            mood = $5,
            source = $6,
            notes = $7,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $8`,
    [
      fields.name,
      fields.bpm,
      fields.musical_key,
      fields.type,
      fields.mood,
      fields.source,
      fields.notes,
      id,
    ],
  );
}

/**
 * Re-points a sample at a new file location (after the original was moved or
 * renamed on disk). Updates the path and original filename only — display name,
 * tags and other metadata are preserved. Throws DuplicateSampleError if the new
 * path is already linked to another sample.
 */
export async function relinkSample(
  id: number,
  filePath: string,
  originalFilename: string,
): Promise<void> {
  const db = await getDb();
  try {
    await db.execute(
      `UPDATE samples
          SET file_path = $1,
              original_filename = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
      [filePath, originalFilename, id],
    );
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      throw new DuplicateSampleError(filePath);
    }
    throw err;
  }
}

/**
 * Replaces the full tag set for a sample. Tags are normalised (trimmed,
 * lower-cased, de-duplicated) and created in the `tags` table if new.
 */
export async function setSampleTags(
  sampleId: number,
  tags: string[],
): Promise<void> {
  const db = await getDb();
  const cleaned = Array.from(
    new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  );

  for (const name of cleaned) {
    await db.execute("INSERT OR IGNORE INTO tags (name) VALUES ($1)", [name]);
  }

  await db.execute("DELETE FROM sample_tags WHERE sample_id = $1", [sampleId]);

  for (const name of cleaned) {
    await db.execute(
      `INSERT OR IGNORE INTO sample_tags (sample_id, tag_id)
       SELECT $1, id FROM tags WHERE name = $2`,
      [sampleId, name],
    );
  }
}

/**
 * Removes a sample from the library. Only the database records are deleted —
 * the original audio file is left in place. The join rows are removed
 * explicitly so deletion is correct regardless of the foreign-key pragma.
 */
export async function deleteSample(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM sample_tags WHERE sample_id = $1", [id]);
  await db.execute("DELETE FROM samples WHERE id = $1", [id]);
}

/** All known tag names, alphabetically — used for the tag picker & filters. */
export async function listAllTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM tags ORDER BY name",
  );
  return rows.map((r) => r.name);
}
