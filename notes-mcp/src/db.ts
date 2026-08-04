import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";

const DB_FILENAME = ".noteeees-index.db";

const SCHEMA = `
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

import type { BaseTask } from "../../shared/taskTypes.js";

export interface TaskRow extends BaseTask {
  sourceType: string;
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
  const totals = db.query("SELECT COUNT(*) AS total, SUM(done) AS done FROM tasks_cache").get() as {
    total: number;
    done: number | null;
  };
  const byDateRows = db
    .query(
      "SELECT date, SUM(done) AS done, COUNT(*) - SUM(done) AS open FROM tasks_cache GROUP BY date",
    )
    .all() as { date: string | null; done: number | null; open: number | null }[];

  const byDate: Record<string, { open: number; done: number }> = {};
  for (const row of byDateRows) {
    byDate[row.date ?? "unknown"] = { open: row.open ?? 0, done: row.done ?? 0 };
  }

  return {
    total: totals.total,
    open: totals.total - (totals.done ?? 0),
    done: totals.done ?? 0,
    byDate,
  };
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
