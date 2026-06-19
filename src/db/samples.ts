import { getDb } from "./schema";
import type { Sample, SampleMetadata, SampleType } from "../types/sample";

/**
 * Separator used to flatten a sample's tags into one column via GROUP_CONCAT.
 * A comma (the GROUP_CONCAT default) would be split apart again on read, so any
 * tag containing a comma would fracture into phantom tags. The ASCII unit
 * separator (0x1F) can't occur in a user-entered tag, so the round-trip is safe.
 */
const TAG_SEPARATOR = "\x1f";

/** Raw row shape returned by the sample list query. */
type SampleRow = {
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
  file_size: number | null;
  content_hash: string | null;
  hash_status: "pending" | "ok" | "error" | null;
  hash_error: string | null;
  hash_updated_at: string | null;
  detected_bpm: number | null;
  detected_bpm_confidence: number | null;
  detected_key: string | null;
  detected_key_confidence: number | null;
  analysis_status: "pending" | "ok" | "error" | null;
  analysis_error: string | null;
  analysis_updated_at: string | null;
  audio_fingerprint: string | null;
  fingerprint_version: number | null;
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

/**
 * Maps SQLite's integer boolean (0/1, stored in the is_favorite column) to a
 * JS boolean. Pure and exported so it can be unit-tested without a database.
 */
export function toFavorite(value: number | null | undefined): boolean {
  return value === 1;
}

/** Normalizes user-entered tags into the stored canonical form. */
export function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  );
}

function rowToSample(row: SampleRow): Sample {
  return {
    id: row.id,
    name: row.name,
    original_filename: row.original_filename ?? undefined,
    file_path: row.file_path,
    original_path: row.original_path ?? undefined,
    bpm: row.bpm ?? undefined,
    musical_key: row.musical_key ?? undefined,
    type: (row.type as SampleType | null) ?? undefined,
    mood: row.mood ?? undefined,
    source: row.source ?? undefined,
    notes: row.notes ?? undefined,
    tags: row.tag_csv
      ? row.tag_csv.split(TAG_SEPARATOR).filter(Boolean).sort()
      : [],
    is_favorite: toFavorite(row.is_favorite),
    duration_seconds: row.duration_seconds ?? undefined,
    sample_rate: row.sample_rate ?? undefined,
    channels: row.channels ?? undefined,
    file_size: row.file_size ?? undefined,
    content_hash: row.content_hash ?? undefined,
    hash_status: row.hash_status ?? undefined,
    hash_error: row.hash_error ?? undefined,
    hash_updated_at: row.hash_updated_at ?? undefined,
    detected_bpm: row.detected_bpm ?? undefined,
    detected_bpm_confidence: row.detected_bpm_confidence ?? undefined,
    detected_key: row.detected_key ?? undefined,
    detected_key_confidence: row.detected_key_confidence ?? undefined,
    analysis_status: row.analysis_status ?? undefined,
    analysis_error: row.analysis_error ?? undefined,
    analysis_updated_at: row.analysis_updated_at ?? undefined,
    audio_fingerprint: row.audio_fingerprint ?? undefined,
    fingerprint_version: row.fingerprint_version ?? undefined,
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
      GROUP_CONCAT(t.name, char(31)) AS tag_csv
    FROM samples s
    LEFT JOIN sample_tags st ON st.sample_id = s.id
    LEFT JOIN tags t ON t.id = st.tag_id
    GROUP BY s.id
    ORDER BY s.created_at DESC, s.id DESC
  `);
  return rows.map(rowToSample);
}

/**
 * Inserts a new sample. `file_path` is the managed copy inside the library;
 * `original_path` is where the file was imported from and is what duplicate
 * detection keys off (managed copies always get a fresh, unique path, so a
 * file_path clash never happens — re-importing the same source does). Throws
 * DuplicateSampleError when that source is already in the library.
 */
export async function createSample(input: {
  name: string;
  original_filename: string;
  file_path: string;
  original_path: string;
  source?: string;
}): Promise<number> {
  const db = await getDb();
  try {
    const res = await db.execute(
      `INSERT INTO samples (name, original_filename, file_path, original_path, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.name,
        input.original_filename,
        input.file_path,
        input.original_path,
        input.source ?? null,
      ],
    );
    return res.lastInsertId as number;
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      throw new DuplicateSampleError(input.original_path);
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
 * Toggles a sample's favorite flag. Stored as an integer 0/1. This is a
 * standalone action rather than a content edit, so updated_at is intentionally
 * left untouched.
 */
export async function setFavorite(id: number, value: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE samples SET is_favorite = $1 WHERE id = $2", [
    value ? 1 : 0,
    id,
  ]);
}

/** Audio metadata read (read-only) from a file's header. */
export type AudioMeta = {
  duration_seconds: number | null;
  sample_rate: number | null;
  channels: number | null;
};

/**
 * Stores cached audio metadata for the sample at the given file path (which is
 * UNIQUE). Keyed by path so it can be applied straight from the Rust
 * `read_metadata` results without a separate id lookup. Not a user edit, so
 * updated_at is left untouched.
 */
export async function setAudioMeta(
  filePath: string,
  meta: AudioMeta,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE samples
        SET duration_seconds = $1, sample_rate = $2, channels = $3
      WHERE file_path = $4`,
    [meta.duration_seconds, meta.sample_rate, meta.channels, filePath],
  );
}

/** Exact hash result for duplicate detection. */
export type FileHashMeta = {
  file_size: number | null;
  content_hash: string | null;
  hash_status: "ok" | "error";
  hash_error: string | null;
};

/** Stores read-only file hash metadata for a sample path. */
export async function setFileHashMeta(
  filePath: string,
  meta: FileHashMeta,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE samples
        SET file_size = $1,
            content_hash = $2,
            hash_status = $3,
            hash_error = $4,
            hash_updated_at = CURRENT_TIMESTAMP
      WHERE file_path = $5`,
    [
      meta.file_size,
      meta.content_hash,
      meta.hash_status,
      meta.hash_error,
      filePath,
    ],
  );
}

/** Result of read-only audio analysis for BPM/key suggestions. */
export type AudioAnalysisMeta = {
  detected_bpm: number | null;
  detected_bpm_confidence: number | null;
  detected_key: string | null;
  detected_key_confidence: number | null;
  audio_fingerprint: string | null;
  fingerprint_version: number | null;
  analysis_status: "ok" | "error";
  analysis_error: string | null;
};

/** Stores suggested analysis metadata for a sample path. */
export async function setAudioAnalysisMeta(
  filePath: string,
  meta: AudioAnalysisMeta,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE samples
        SET detected_bpm = $1,
            detected_bpm_confidence = $2,
            detected_key = $3,
            detected_key_confidence = $4,
            audio_fingerprint = $5,
            fingerprint_version = $6,
            analysis_status = $7,
            analysis_error = $8,
            analysis_updated_at = CURRENT_TIMESTAMP
      WHERE file_path = $9`,
    [
      meta.detected_bpm,
      meta.detected_bpm_confidence,
      meta.detected_key,
      meta.detected_key_confidence,
      meta.audio_fingerprint,
      meta.fingerprint_version,
      meta.analysis_status,
      meta.analysis_error,
      filePath,
    ],
  );
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
  const cleaned = normalizeTags(tags);

  for (const name of cleaned) {
    await db.execute("INSERT OR IGNORE INTO tags (name) VALUES ($1)", [name]);
  }

  for (const name of cleaned) {
    await db.execute(
      `INSERT OR IGNORE INTO sample_tags (sample_id, tag_id)
       SELECT $1, id FROM tags WHERE name = $2`,
      [sampleId, name],
    );
  }

  if (cleaned.length === 0) {
    await db.execute("DELETE FROM sample_tags WHERE sample_id = $1", [sampleId]);
    return;
  }

  await db.execute(
    `DELETE FROM sample_tags
      WHERE sample_id = $1
        AND tag_id NOT IN (
          SELECT id FROM tags
          WHERE name IN (${cleaned.map((_, i) => `$${i + 2}`).join(", ")})
        )`,
    [sampleId, ...cleaned],
  );
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

/**
 * Re-points a sample at a managed copy that moved within the library (e.g. after
 * a type change re-files it, or the one-time migration copies it in). Only the
 * path changes — display name, original filename, tags and other metadata are
 * preserved.
 */
export async function setFilePath(id: number, filePath: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE samples
        SET file_path = $1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [filePath, id],
  );
}

/** Reads a run-once / configuration value from the app_meta key-value table. */
export async function getAppMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM app_meta WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

/** Writes (upserts) a value into the app_meta key-value table. */
export async function setAppMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** All known tag names, alphabetically — used for the tag picker & filters. */
export async function listAllTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM tags ORDER BY name",
  );
  return rows.map((r) => r.name);
}
