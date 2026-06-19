import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:sampletracker.db";

/** A starter set of reusable tags, seeded on first launch. */
export const DEFAULT_TAGS = [
  "kick",
  "snare",
  "hat",
  "percussion",
  "drums",
  "bass",
  "guitar",
  "piano",
  "vocal",
  "loop",
  "one-shot",
  "texture",
  "fx",
  "soul",
  "jazz",
  "dusty",
  "trap",
  "boom-bap",
  "ambient",
];

/**
 * A single forward-only schema migration. `up` runs exactly once, when the
 * database's `PRAGMA user_version` is below `version`.
 */
export type Migration = {
  version: number;
  up: (db: Database) => Promise<void>;
};

type TableColumn = { name: string };

/**
 * Adds a column only when it is absent. SQLite does not support
 * `ADD COLUMN IF NOT EXISTS`, so checking `table_info` makes multi-step
 * migrations safe to retry after an interrupted launch.
 */
async function addColumnIfMissing(
  db: Database,
  table: "samples",
  column: string,
  definition: string,
): Promise<void> {
  const columns = await db.select<TableColumn[]>(`PRAGMA table_info(${table})`);
  if (columns.some((existing) => existing.name === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Ordered (ascending `version`) list of migrations applied after the baseline
 * schema above.
 *
 * SCHEMA-CHANGE DISCIPLINE: the `CREATE TABLE IF NOT EXISTS` baseline in
 * initDb() represents the current schema that both fresh and existing
 * databases already have. NEW columns (and any other non-idempotent change,
 * e.g. `ALTER TABLE ... ADD COLUMN`) MUST be added as a MIGRATIONS entry with
 * the next version number — never by editing the baseline `CREATE TABLE`. That
 * way fresh databases (which get the baseline + every migration) and existing
 * databases (which get only the pending migrations) converge on the same
 * schema via the same code path.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: async (db) => {
      await addColumnIfMissing(
        db,
        "samples",
        "is_favorite",
        "INTEGER NOT NULL DEFAULT 0",
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_samples_favorite ON samples(is_favorite) WHERE is_favorite = 1",
      );
    },
  },
  {
    // Cached audio metadata extracted (read-only) from the file headers via the
    // Rust `read_metadata` command. Nullable: unknown until a file is scanned.
    version: 2,
    up: async (db) => {
      await addColumnIfMissing(db, "samples", "duration_seconds", "REAL");
      await addColumnIfMissing(db, "samples", "sample_rate", "INTEGER");
      await addColumnIfMissing(db, "samples", "channels", "INTEGER");
    },
  },
  {
    // Exact duplicate detection. The app stores a file size and content hash
    // for files already in the local library; it never copies or mutates audio.
    version: 3,
    up: async (db) => {
      await addColumnIfMissing(db, "samples", "file_size", "INTEGER");
      await addColumnIfMissing(db, "samples", "content_hash", "TEXT");
      await addColumnIfMissing(db, "samples", "hash_status", "TEXT");
      await addColumnIfMissing(db, "samples", "hash_error", "TEXT");
      await addColumnIfMissing(db, "samples", "hash_updated_at", "TEXT");
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_samples_content_hash ON samples(content_hash)",
      );
    },
  },
  {
    // Read-only analysis suggestions. User-entered BPM/key remain separate so
    // detected values can be reviewed before being applied.
    version: 4,
    up: async (db) => {
      await addColumnIfMissing(db, "samples", "detected_bpm", "REAL");
      await addColumnIfMissing(
        db,
        "samples",
        "detected_bpm_confidence",
        "REAL",
      );
      await addColumnIfMissing(db, "samples", "detected_key", "TEXT");
      await addColumnIfMissing(
        db,
        "samples",
        "detected_key_confidence",
        "REAL",
      );
      await addColumnIfMissing(db, "samples", "analysis_status", "TEXT");
      await addColumnIfMissing(db, "samples", "analysis_error", "TEXT");
      await addColumnIfMissing(db, "samples", "analysis_updated_at", "TEXT");
      await addColumnIfMissing(db, "samples", "audio_fingerprint", "TEXT");
      await addColumnIfMissing(db, "samples", "fingerprint_version", "INTEGER");
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_samples_audio_fingerprint ON samples(audio_fingerprint)",
      );
    },
  },
  {
    // Managed library. file_path now points at an app-owned copy inside the
    // library folder; original_path records where each file was imported from,
    // so duplicate detection keys off the source (managed copies are always a
    // fresh, unique path). Existing rows are backfilled from file_path — at this
    // point file_path is still the original location, before the one-time file
    // migration moves copies into the library. app_meta holds run-once flags
    // such as the library-migration marker.
    version: 5,
    up: async (db) => {
      await addColumnIfMissing(db, "samples", "original_path", "TEXT");
      await db.execute(
        "UPDATE samples SET original_path = file_path WHERE original_path IS NULL",
      );
      await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_samples_original_path ON samples(original_path)",
      );
      await db.execute(
        "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)",
      );
    },
  },
]; // future steps appended here, ascending version

/**
 * Pure selector: returns the migrations whose `version` is greater than
 * `currentVersion`, sorted ascending by version. No DB access and no mutation
 * of the input array, so it can be unit-tested without a database.
 */
export function pendingMigrations(
  currentVersion: number,
  migrations: Migration[],
): Migration[] {
  return migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);
}

let dbPromise: Promise<Database> | null = null;

/**
 * Returns the shared database connection, initialising the schema on first
 * call. The promise is cached so repeated calls (and React StrictMode's
 * double-invoked effects) reuse a single connection and run migration once.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = initDb().catch((err) => {
      // Reset so a later call can retry if initialisation failed.
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function initDb(): Promise<Database> {
  const db = await Database.load(DB_URL);

  // WAL permits readers while the native atomic save command writes. A finite
  // busy timeout makes short lock contention retry instead of failing at once.
  await db.execute("PRAGMA journal_mode = WAL;");
  await db.execute("PRAGMA busy_timeout = 5000;");
  // Enforce ON DELETE CASCADE on the join table.
  await db.execute("PRAGMA foreign_keys = ON;");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      original_filename TEXT,
      file_path TEXT NOT NULL UNIQUE,
      bpm INTEGER,
      musical_key TEXT,
      type TEXT,
      mood TEXT,
      source TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sample_tags (
      sample_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (sample_id, tag_id),
      FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  // Indexes covering the columns the app actually orders/joins by. These are
  // idempotent (IF NOT EXISTS) so they fit the additive-only schema convention.
  // - samples.created_at: the default list ordering in listSamples().
  // - sample_tags.tag_id: the reverse join (the composite PK only covers
  //   sample_id-first lookups), needed for tag-driven queries.
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_samples_created_at ON samples(created_at)",
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_sample_tags_tag_id ON sample_tags(tag_id)",
  );

  for (const tag of DEFAULT_TAGS) {
    await db.execute("INSERT OR IGNORE INTO tags (name) VALUES ($1)", [tag]);
  }

  await runMigrations(db);

  return db;
}

/**
 * Runs any pending migrations (those above the database's current
 * `PRAGMA user_version`) in ascending order, bumping `user_version` after each
 * after each completed migration. Individual column additions are idempotent,
 * so an interrupted multi-step migration can safely retry. PRAGMA statements
 * cannot take bound parameters, so the version integer is interpolated from
 * the migration list (and validated as a safe integer), not user input.
 */
async function runMigrations(db: Database): Promise<void> {
  const rows = await db.select<{ user_version: number }[]>(
    "PRAGMA user_version",
  );
  const currentVersion = rows[0]?.user_version ?? 0;

  for (const migration of pendingMigrations(currentVersion, MIGRATIONS)) {
    if (!Number.isSafeInteger(migration.version)) {
      throw new Error(
        `Migration version must be a safe integer, got: ${migration.version}`,
      );
    }
    await migration.up(db);
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
}
