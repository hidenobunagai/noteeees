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

CREATE TABLE IF NOT EXISTS tasks_cache (
  id          TEXT PRIMARY KEY,
  file_path   TEXT NOT NULL,
  line_index  INTEGER NOT NULL,
  text        TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  date        TEXT,
  source_type TEXT NOT NULL DEFAULT 'note',
  tags_json   TEXT NOT NULL DEFAULT '[]',
  mtime       REAL NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_tasks (
  task_id           TEXT PRIMARY KEY REFERENCES tasks_cache(id),
  category          TEXT,
  priority          TEXT,
  time_estimate_min INTEGER,
  ai_summary        TEXT,
  enriched_at       TEXT NOT NULL
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

export async function syncNotesIndex(
  notesDir: string,
  diskFiles: { filePath: string; mtime: number }[],
  parseFile: (filePath: string, mtime: number) => Promise<NoteEntry>,
): Promise<NoteEntry[]> {
  const db = getDb(notesDir);
  const storedMtimes = getStoredMtimes(db);
  const diskPathSet = new Set(diskFiles.map((f) => f.filePath));

  for (const storedPath of storedMtimes.keys()) {
    if (!diskPathSet.has(storedPath)) {
      deleteEntry(db, storedPath);
    }
  }

  for (const { filePath, mtime } of diskFiles) {
    const storedMtime = storedMtimes.get(filePath);
    if (storedMtime === mtime) continue;
    const entry = await parseFile(filePath, mtime);
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

// ---------------------------------------------------------------------------
// tasks_cache CRUD
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  filePath: string;
  lineIndex: number;
  text: string;
  done: boolean;
  date: string | null;
  sourceType: string;
  tags: string[];
  mtime: number;
  updatedAt: string;
}

interface RawTaskRow {
  id: string;
  file_path: string;
  line_index: number;
  text: string;
  done: number;
  date: string | null;
  source_type: string;
  tags_json: string;
  mtime: number;
  updated_at: string;
}

function rawToTaskRow(r: RawTaskRow): TaskRow {
  return {
    id: r.id,
    filePath: r.file_path,
    lineIndex: r.line_index,
    text: r.text,
    done: r.done !== 0,
    date: r.date,
    sourceType: r.source_type,
    tags: JSON.parse(r.tags_json) as string[],
    mtime: r.mtime,
    updatedAt: r.updated_at,
  };
}

export function upsertTask(notesDir: string, task: TaskRow): void {
  const db = getDb(notesDir);
  db.run(
    `INSERT OR REPLACE INTO tasks_cache
      (id, file_path, line_index, text, done, date, source_type, tags_json, mtime, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.filePath,
      task.lineIndex,
      task.text,
      task.done ? 1 : 0,
      task.date ?? null,
      task.sourceType,
      JSON.stringify(task.tags),
      task.mtime,
      task.updatedAt,
    ],
  );
}

export function deleteTasksByFile(notesDir: string, filePath: string): void {
  const db = getDb(notesDir);
  db.run("DELETE FROM tasks_cache WHERE file_path = ?", [filePath]);
}

export function getTaskById(notesDir: string, id: string): TaskRow | null {
  const db = getDb(notesDir);
  const row = db.query("SELECT * FROM tasks_cache WHERE id = ?").get(id) as RawTaskRow | null;
  return row ? rawToTaskRow(row) : null;
}

export function queryTasks(
  notesDir: string,
  opts: {
    status?: "all" | "open" | "done";
    dateFrom?: string;
    dateTo?: string;
    sourceType?: "all" | "note";
    limit?: number;
  } = {},
): TaskRow[] {
  const db = getDb(notesDir);
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.status === "open") {
    conditions.push("done = 0");
  } else if (opts.status === "done") {
    conditions.push("done = 1");
  }
  if (opts.dateFrom) {
    conditions.push("date >= ?");
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    conditions.push("date <= ?");
    params.push(opts.dateTo);
  }
  if (opts.sourceType && opts.sourceType !== "all") {
    conditions.push("source_type = ?");
    params.push(opts.sourceType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = opts.limit && opts.limit > 0 ? `LIMIT ?` : "";
  const sql = `SELECT * FROM tasks_cache ${where} ORDER BY date DESC, line_index ASC ${limitClause}`;
  const queryParams = opts.limit && opts.limit > 0 ? [...params, opts.limit] : params;
  return (db.query(sql).all(...queryParams) as RawTaskRow[]).map(rawToTaskRow);
}

export function setTaskDone(notesDir: string, id: string, done: boolean): void {
  const db = getDb(notesDir);
  db.run("UPDATE tasks_cache SET done = ?, updated_at = ? WHERE id = ?", [
    done ? 1 : 0,
    new Date().toISOString(),
    id,
  ]);
}

export function getTaskStats(notesDir: string): {
  total: number;
  open: number;
  done: number;
  byDate: Record<string, { open: number; done: number }>;
} {
  const db = getDb(notesDir);
  const rows = db.query("SELECT done, date FROM tasks_cache").all() as {
    done: number;
    date: string | null;
  }[];
  const byDate: Record<string, { open: number; done: number }> = {};
  let open = 0;
  let done = 0;
  for (const r of rows) {
    if (r.done) {
      done++;
    } else {
      open++;
    }
    const d = r.date ?? "unknown";
    if (!byDate[d]) byDate[d] = { open: 0, done: 0 };
    if (r.done) byDate[d].done++;
    else byDate[d].open++;
  }
  return { total: rows.length, open, done, byDate };
}

export function syncTasksForFile(notesDir: string, filePath: string, tasks: TaskRow[]): void {
  deleteTasksByFile(notesDir, filePath);
  for (const task of tasks) {
    upsertTask(notesDir, task);
  }
}

export function getStoredTaskMtimes(notesDir: string): Map<string, number> {
  const db = getDb(notesDir);
  const rows = db.query("SELECT DISTINCT file_path, mtime FROM tasks_cache").all() as {
    file_path: string;
    mtime: number;
  }[];
  return new Map(rows.map((r) => [r.file_path, r.mtime]));
}
