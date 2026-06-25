import { getDb } from "./schema";

/** A source folder the user has pointed the library at for scanning. */
export type WatchedFolder = {
  id: number;
  path: string;
  added_at: string;
  last_scanned_at: string | null;
};

type WatchedFolderRow = {
  id: number;
  path: string;
  added_at: string;
  last_scanned_at: string | null;
};

/** All remembered folders, most recently added first. */
export async function listWatchedFolders(): Promise<WatchedFolder[]> {
  const db = await getDb();
  const rows = await db.select<WatchedFolderRow[]>(
    "SELECT id, path, added_at, last_scanned_at FROM watched_folders ORDER BY added_at DESC, id DESC",
  );
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    added_at: row.added_at,
    last_scanned_at: row.last_scanned_at ?? null,
  }));
}

/**
 * Remembers a folder as a scan source, returning its row id. Idempotent: adding
 * a folder that is already tracked returns the existing row's id rather than
 * inserting a duplicate (the `path` UNIQUE constraint).
 */
export async function addWatchedFolder(path: string): Promise<number> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO watched_folders (path) VALUES ($1)", [
    path,
  ]);
  const rows = await db.select<{ id: number }[]>(
    "SELECT id FROM watched_folders WHERE path = $1",
    [path],
  );
  return rows[0]!.id;
}

/** Forgets a folder. Already-imported samples are unaffected. */
export async function removeWatchedFolder(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM watched_folders WHERE id = $1", [id]);
}

/** Records that a folder finished a scan just now. */
export async function setFolderScannedAt(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE watched_folders SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = $1",
    [id],
  );
}
