import * as fs from "fs/promises";
import { collectTasksFromNotes } from "./dashboardTaskCollector.js";
import {
  buildTaskMarkdownLine,
  ensureDashboardTaskFile,
  normalizeExtractedTaskIdentity,
  resolveTaskRef,
  TASK_RE,
  upsertDashboardDueDate,
} from "./dashboardTaskUtils.js";

export type DashboardTaskCreateResult = "created" | "invalid-text";
export type DashboardTaskUpdateResult = "updated" | "missing" | "invalid-text";

async function readTaskLines(filePath: string): Promise<string[] | null> {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }

  return (await fs.readFile(filePath, "utf8")).split("\n");
}

export async function toggleDashboardTask(
  notesDir: string,
  taskId: string,
  done: boolean,
): Promise<boolean> {
  const ref = resolveTaskRef(notesDir, taskId);
  if (!ref) {
    return false;
  }

  const lines = await readTaskLines(ref.filePath);
  if (!lines) {
    return false;
  }

  const line = lines[ref.lineIndex];
  if (!line) {
    return false;
  }

  const match = TASK_RE.exec(line);
  if (!match) {
    return false;
  }

  lines[ref.lineIndex] = buildTaskMarkdownLine(done, match[2].trim());
  await fs.writeFile(ref.filePath, lines.join("\n"), "utf8");
  return true;
}

export async function updateDashboardTask(
  notesDir: string,
  taskId: string,
  text: string,
  dueDate: string | null,
): Promise<DashboardTaskUpdateResult> {
  const normalizedText = upsertDashboardDueDate(text, dueDate);
  if (!normalizedText) {
    return "invalid-text";
  }

  const ref = resolveTaskRef(notesDir, taskId);
  if (!ref) {
    return "missing";
  }

  const lines = await readTaskLines(ref.filePath);
  if (!lines) {
    return "missing";
  }

  const line = lines[ref.lineIndex];
  if (!line) {
    return "missing";
  }

  const match = TASK_RE.exec(line);
  if (!match) {
    return "missing";
  }

  lines[ref.lineIndex] = buildTaskMarkdownLine(match[1].toLowerCase() === "x", normalizedText);
  await fs.writeFile(ref.filePath, lines.join("\n"), "utf8");
  return "updated";
}

export async function deleteDashboardTask(notesDir: string, taskId: string): Promise<boolean> {
  const ref = resolveTaskRef(notesDir, taskId);
  if (!ref) {
    return false;
  }

  const lines = await readTaskLines(ref.filePath);
  if (!lines) {
    return false;
  }

  const line = lines[ref.lineIndex];
  if (!line || !TASK_RE.exec(line)) {
    return false;
  }

  lines.splice(ref.lineIndex, 1);
  await fs.writeFile(ref.filePath, lines.join("\n"), "utf8");
  return true;
}

export async function createDashboardTask(
  notesDir: string,
  text: string,
  targetDate: string | null,
  dueDate: string | null,
): Promise<DashboardTaskCreateResult> {
  const normalizedText = upsertDashboardDueDate(text, dueDate);
  if (!normalizedText) {
    return "invalid-text";
  }

  const taskFile = await ensureDashboardTaskFile(notesDir, targetDate);
  const existing = await fs.readFile(taskFile, "utf8");
  const prefix = existing.endsWith("\n") ? "" : "\n";
  await fs.writeFile(
    taskFile,
    `${existing}${prefix}${buildTaskMarkdownLine(false, normalizedText)}\n`,
    "utf8",
  );
  return "created";
}

export async function hasExistingDashboardTask(notesDir: string, text: string): Promise<boolean> {
  const targetKey = normalizeExtractedTaskIdentity(text);
  if (!targetKey) {
    return false;
  }

  const tasks = await collectTasksFromNotes(notesDir);
  return tasks.some((task) => normalizeExtractedTaskIdentity(task.text) === targetKey);
}
