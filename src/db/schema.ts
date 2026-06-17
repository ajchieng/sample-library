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

  for (const tag of DEFAULT_TAGS) {
    await db.execute("INSERT OR IGNORE INTO tags (name) VALUES ($1)", [tag]);
  }

  return db;
}
