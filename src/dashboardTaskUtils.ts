import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type {
  DashTask,
  DashboardCandidateTask,
  DashboardTaskSection,
  DismissedExtractedTask,
  ExtractedTaskFilterResult,
} from "./dashboardTypes.js";
import type {
  ExtractedTask,
  ExtractedTaskWithSource,
  ExtractTasksFailureReason,
} from "./aiTaskProcessor.js";
import { isPathInside } from "../shared/pathSafety.js";
import { stripDueDateTokens } from "../shared/taskSyntax.js";
import { t } from "./i18n.js";
export { DUE_DATE_RE, TAG_RE, TASK_RE } from "../shared/taskSyntax.js";
export { isPathInside } from "../shared/pathSafety.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXTRACTED_TASK_DISMISS_WINDOW_DAYS = 30;
const MAX_DISMISSED_EXTRACTED_TASKS = 200;
export const SECTION_ORDER: Record<DashboardTaskSection, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  scheduled: 3,
  backlog: 4,
  unsorted: 5,
  done: 6,
};
export const ATTENTION_SECTIONS = new Set<DashboardTaskSection>(["overdue", "today", "upcoming"]);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function notesDirHash(notesDir: string): string {
  return crypto.createHash("sha1").update(path.resolve(notesDir)).digest("hex");
}

export function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatTimeHM(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function todayDateString(): string {
  return formatDateString(new Date());
}

function isIsoDateString(value: string | null | undefined): value is string {
  return Boolean(value && ISO_DATE_RE.test(value));
}

export function normalizeOptionalDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_RE.test(value) ? value : null;
}

export function dateFromFilePath(filePath: string): string | null {
  const m = path.basename(filePath, ".md").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function getRelativePathFromTaskId(taskId: string, fallbackFilePath: string): string {
  const colonIdx = taskId.lastIndexOf(":");
  return colonIdx >= 0 ? taskId.slice(0, colonIdx) : path.basename(fallbackFilePath);
}

function sanitizeTaskInputText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeExtractedTaskIdentity(text: string): string {
  return stripDashboardDueDate(text).normalize("NFKC").toLowerCase();
}

function stripDashboardDueDate(text: string): string {
  return stripDueDateTokens(sanitizeTaskInputText(text));
}

export function upsertDashboardDueDate(text: string, dueDate?: string | null): string {
  const baseText = stripDashboardDueDate(text);
  if (!baseText) {
    return "";
  }

  return isIsoDateString(dueDate) ? `${baseText} @${dueDate}` : baseText;
}

export function resolveDashboardTaskFile(notesDir: string, targetDate?: string | null): string {
  const taskDir = path.join(notesDir, "tasks");
  return isIsoDateString(targetDate)
    ? path.join(taskDir, `${targetDate}.md`)
    : path.join(taskDir, "inbox.md");
}

function buildTaskFileHeader(targetDate: string | null): string {
  return targetDate
    ? `---\ntype: tasks\ndate: ${targetDate}\n---\n\n`
    : `---\ntype: tasks\n---\n\n`;
}

export async function ensureDashboardTaskFile(
  notesDir: string,
  targetDate: string | null,
): Promise<string> {
  const filePath = resolveDashboardTaskFile(notesDir, targetDate);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, buildTaskFileHeader(targetDate), "utf8");
  }

  return filePath;
}

export function resolveTaskRef(
  notesDir: string,
  taskId: string,
): { relativePath: string; filePath: string; lineIndex: number } | null {
  const colonIdx = taskId.lastIndexOf(":");
  if (colonIdx < 0) {
    return null;
  }

  const relativePath = taskId.slice(0, colonIdx);
  const lineIndex = Number.parseInt(taskId.slice(colonIdx + 1), 10);
  if (!Number.isInteger(lineIndex) || lineIndex < 0) {
    return null;
  }

  const filePath = path.resolve(notesDir, relativePath);
  if (!isPathInside(notesDir, filePath)) {
    return null;
  }

  return {
    relativePath,
    filePath,
    lineIndex,
  };
}

export function buildTaskMarkdownLine(done: boolean, text: string): string {
  return `- [${done ? "x" : " "}] ${text}`;
}

export function shiftDate(baseDate: string, days: number): string {
  const d = new Date(`${baseDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDateString(d);
}

function normalizeDashboardCandidateTask(value: unknown): DashboardCandidateTask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const task = value as Partial<DashboardCandidateTask>;
  const text = sanitizeTaskInputText(typeof task.text === "string" ? task.text : "");
  if (!text) {
    return null;
  }

  return {
    kind: "candidate",
    text,
    dueDate: normalizeOptionalDate(task.dueDate),
    category:
      typeof task.category === "string" && task.category.trim().length > 0
        ? task.category
        : "other",
    priority:
      typeof task.priority === "string" && task.priority.trim().length > 0
        ? task.priority
        : "medium",
    timeEstimateMin:
      typeof task.timeEstimateMin === "number" && Number.isFinite(task.timeEstimateMin)
        ? task.timeEstimateMin
        : 0,
    source: task.source === "notes" ? "notes" : "moments",
    sourceLabel:
      typeof task.sourceLabel === "string" && task.sourceLabel.trim().length > 0
        ? task.sourceLabel
        : task.source === "notes"
          ? "Notes"
          : "Moments",
    existsAlready: Boolean(task.existsAlready),
    extractRunAt: typeof task.extractRunAt === "string" ? task.extractRunAt : undefined,
  };
}

export function normalizeDismissedExtractedTasks(value: unknown): DismissedExtractedTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const key = "key" in entry && typeof entry.key === "string" ? entry.key : null;
      const dismissedAt =
        "dismissedAt" in entry && typeof entry.dismissedAt === "string" ? entry.dismissedAt : null;
      if (!key || !isIsoDateString(dismissedAt)) {
        return null;
      }

      return { key, dismissedAt };
    })
    .filter((entry): entry is DismissedExtractedTask => entry !== null);
}

export function pruneDismissedExtractedTasks(
  entries: DismissedExtractedTask[],
  today = todayDateString(),
): DismissedExtractedTask[] {
  const cutoff = shiftDate(today, -EXTRACTED_TASK_DISMISS_WINDOW_DAYS);
  const latestByKey = new Map<string, DismissedExtractedTask>();

  for (const entry of entries) {
    if (!entry.key || entry.dismissedAt < cutoff) {
      continue;
    }

    const existing = latestByKey.get(entry.key);
    if (!existing || existing.dismissedAt < entry.dismissedAt) {
      latestByKey.set(entry.key, entry);
    }
  }

  return Array.from(latestByKey.values())
    .sort((a, b) => a.dismissedAt.localeCompare(b.dismissedAt))
    .slice(-MAX_DISMISSED_EXTRACTED_TASKS);
}

export function canAddDashboardCandidate(
  task: DashboardCandidateTask,
  existingTaskKeys?: ReadonlySet<string>,
): boolean {
  if (existingTaskKeys && existingTaskKeys.has(normalizeExtractedTaskIdentity(task.text))) {
    return false;
  }

  return !task.existsAlready;
}

export function filterExtractedTasksForDisplay(
  extractedTasks: Array<ExtractedTask | ExtractedTaskWithSource>,
  existingTasks: DashTask[],
  dismissedTasks: DismissedExtractedTask[],
  today = todayDateString(),
): ExtractedTaskFilterResult {
  const existingKeys = new Set(
    existingTasks.map((task) => normalizeExtractedTaskIdentity(task.text)).filter(Boolean),
  );
  const dismissedKeys = new Set(
    pruneDismissedExtractedTasks(dismissedTasks, today).map((entry) => entry.key),
  );
  const seenKeys = new Set<string>();

  const visibleTasks: DashboardCandidateTask[] = [];
  let hiddenDismissed = 0;
  let hiddenDuplicates = 0;

  for (const task of extractedTasks) {
    const normalizedTask = normalizeDashboardCandidateTask(task);
    if (!normalizedTask) {
      continue;
    }

    const key = normalizeExtractedTaskIdentity(normalizedTask.text);
    if (!key) {
      hiddenDuplicates++;
      continue;
    }

    if (seenKeys.has(key)) {
      hiddenDuplicates++;
      continue;
    }
    seenKeys.add(key);

    if (dismissedKeys.has(key)) {
      hiddenDismissed++;
      continue;
    }

    const isNotesTask = typeof task === "object" && task !== null && "sourceNote" in task;
    const source = isNotesTask ? "notes" : "moments";
    visibleTasks.push({
      kind: "candidate",
      text: normalizedTask.text,
      dueDate: normalizedTask.dueDate,
      category: normalizedTask.category,
      priority: normalizedTask.priority,
      timeEstimateMin: normalizedTask.timeEstimateMin,
      source,
      sourceLabel: isNotesTask ? task.sourceNote : "Moments",
      existsAlready: existingKeys.has(key),
    });
  }

  return {
    visibleTasks,
    hiddenDismissed,
    hiddenDuplicates,
  };
}

export function buildExtractedTaskStatusMessage(result: ExtractedTaskFilterResult): string {
  const hiddenParts: string[] = [];
  if (result.hiddenDismissed > 0) {
    hiddenParts.push(t("hiddenDismissed", { count: result.hiddenDismissed }));
  }
  if (result.hiddenDuplicates > 0) {
    hiddenParts.push(t("hiddenDuplicates", { count: result.hiddenDuplicates }));
  }

  if (result.visibleTasks.length === 0) {
    return hiddenParts.length > 0
      ? t("noNewCandidates", { hidden: hiddenParts.join(t("listSeparator")) })
      : t("noActionableTasks");
  }

  return hiddenParts.length > 0
    ? t("candidatesShown", {
        count: result.visibleTasks.length,
        hidden: hiddenParts.join(t("listSeparator")),
      })
    : t("candidatesShownSimple", { count: result.visibleTasks.length });
}

export function buildExtractedTaskFailureMessage(reason: ExtractTasksFailureReason): string {
  if (reason === "modelUnavailable") {
    return t("modelUnavailable");
  }

  if (reason === "requestFailed") {
    return t("requestFailed");
  }

  return t("noActionableTasks");
}

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function toScriptData(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/<\/script/gi, "<\\/script");
}
