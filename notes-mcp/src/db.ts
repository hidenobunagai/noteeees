import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import type { NoteEntry } from "./search.js";

const DB_FILENAME = ".noteeees-index.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes_cache (
  file_path TEXT PRIMARY KEY,
  filename  TEXT    NOT NULL,
  mtime     REAL    NOT NULL,
  title     TEXT    NOT NULL,
  tags_json TEXT    NOT NULL,
  content   TEXT    NOT NULL,
  created_at TEXT
);
`;

let openDb: Database | null = null;

function getDb(notesDir: string): Database {
  if (openDb) return openDb;
  const dbPath = path.join(notesDir, DB_FILENAME);
  openDb = new Database(dbPath, { create: true });
  openDb.exec(SCHEMA);
  return openDb;
}

export function closeDb(): void {
  openDb?.close();
  openDb = null;
}

interface DbRow {
  file_path: string;
  filename: string;
  mtime: number;
  title: string;
  tags_json: string;
  content: string;
  created_at: string | null;
}

function rowToEntry(row: DbRow): NoteEntry {
  return {
    filePath: row.file_path,
    filename: row.filename,
    mtime: row.mtime,
    title: row.title,
    tags: JSON.parse(row.tags_json) as string[],
    content: row.content,
    createdAt: row.created_at,
  };
}

function upsertEntry(db: Database, entry: NoteEntry): void {
  db.run(
    `INSERT OR REPLACE INTO notes_cache
      (file_path, filename, mtime, title, tags_json, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.filePath,
      entry.filename,
      entry.mtime,
      entry.title,
      JSON.stringify(entry.tags),
      entry.content,
      entry.createdAt ?? null,
    ],
  );
}

function deleteEntry(db: Database, filePath: string): void {
  db.run("DELETE FROM notes_cache WHERE file_path = ?", [filePath]);
}

function loadAllEntries(db: Database): NoteEntry[] {
  return (db.query("SELECT * FROM notes_cache").all() as DbRow[]).map(rowToEntry);
}

function getStoredMtimes(db: Database): Map<string, number> {
  const rows = db.query("SELECT file_path, mtime FROM notes_cache").all() as {
    file_path: string;
    mtime: number;
  }[];
  return new Map(rows.map((r) => [r.file_path, r.mtime]));
}

export function syncNotesIndex(
  notesDir: string,
  diskFiles: { filePath: string; mtime: number }[],
  parseFile: (filePath: string, mtime: number) => NoteEntry,
): NoteEntry[] {
  const db = getDb(notesDir);
  const storedMtimes = getStoredMtimes(db);
  const diskPathSet = new Set(diskFiles.map((f) => f.filePath));

  // Remove entries for files that no longer exist on disk
  for (const storedPath of storedMtimes.keys()) {
    if (!diskPathSet.has(storedPath)) {
      deleteEntry(db, storedPath);
    }
  }

  // Insert or update entries that are new or have changed mtime
  for (const { filePath, mtime } of diskFiles) {
    const storedMtime = storedMtimes.get(filePath);
    if (storedMtime === mtime) continue;
    const entry = parseFile(filePath, mtime);
    upsertEntry(db, entry);
  }

  return loadAllEntries(db);
}

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

let watcher: ReturnType<typeof fs.watch> | null = null;
let invalidateCache: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startFileWatcher(notesDir: string, onInvalidate: () => void): void {
  stopFileWatcher();
  if (!fs.existsSync(notesDir)) return;
  invalidateCache = onInvalidate;

  try {
    watcher = fs.watch(notesDir, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        invalidateCache?.();
        debounceTimer = null;
      }, 300);
    });
  } catch {
    // File watching is best-effort — ignore errors on unsupported platforms
  }
}

export function stopFileWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  watcher?.close();
  watcher = null;
}
