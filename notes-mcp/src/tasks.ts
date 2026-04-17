import * as path from "path";
import type { TaskRow } from "./db.js";
import { deleteTasksByFile, getStoredTaskMtimes, upsertTask } from "./db.js";
import { extractDueDate as extractTaskDueDate, TAG_RE, TASK_RE } from "./taskSyntax.js";

// ---------------------------------------------------------------------------
// task parser
// ---------------------------------------------------------------------------

function extractDateFromFilename(filePath: string): string | null {
  const base = path.basename(filePath, ".md");
  const m = base.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function parseTasksFromFile(filePath: string, content: string, mtime: number): TaskRow[] {
  const date = extractDateFromFilename(filePath);
  const now = new Date().toISOString();
  const tasks: TaskRow[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const m = TASK_RE.exec(lines[i]);
    if (!m) continue;
    const done = m[1].toLowerCase() === "x";
    const rawText = m[2].trim();
    const tags = [...new Set(rawText.match(TAG_RE) ?? [])];
    const id = `${filePath}:${i}`;
    tasks.push({
      id,
      filePath,
      lineIndex: i,
      text: rawText,
      done,
      date,
      sourceType: "note",
      tags,
      mtime,
      updatedAt: now,
    });
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// incremental sync (same pattern as syncNotesIndex in db.ts)
// ---------------------------------------------------------------------------

export function syncTasksIndex(
  notesDir: string,
  diskFiles: { filePath: string; mtime: number; content: string }[],
): TaskRow[] {
  const storedMtimes = getStoredTaskMtimes(notesDir);
  const diskPathSet = new Set(diskFiles.map((f) => f.filePath));

  // Remove tasks for deleted files
  for (const storedPath of storedMtimes.keys()) {
    if (!diskPathSet.has(storedPath)) {
      deleteTasksByFile(notesDir, storedPath);
    }
  }

  const all: TaskRow[] = [];
  for (const { filePath, mtime, content } of diskFiles) {
    const storedMtime = storedMtimes.get(filePath);
    if (storedMtime === mtime) continue; // no change
    const tasks = parseTasksFromFile(filePath, content, mtime);
    deleteTasksByFile(notesDir, filePath);
    for (const task of tasks) {
      upsertTask(notesDir, task);
      all.push(task);
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// reminder helper
// ---------------------------------------------------------------------------

export function extractDueDate(text: string): string | null {
  return extractTaskDueDate(text);
}
