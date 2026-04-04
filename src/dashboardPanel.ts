import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildDashboardExtractSectionHtml } from "./dashboardExtractLayout.js";
import {
  extractTasksFromTextWithStatus,
  extractTasksFromNotes,
  aggregateNoteContents,
  type ExtractedTask,
  type ExtractTasksFailureReason,
  type NoteContent,
  type ExtractedTaskWithSource,
  type McpClient,
} from "./aiTaskProcessor.js";

// ---------------------------------------------------------------------------
// Task types used by the extension side (no bun:sqlite dependency)
// ---------------------------------------------------------------------------

export interface DashTask {
  id: string; // `${relPath}:${lineIndex}`
  filePath: string;
  lineIndex: number;
  text: string;
  done: boolean;
  date: string | null;
  dueDate: string | null;
  tags: string[];
}

export interface WeekDay {
  date: string;
  label: string;
  open: number;
  done: number;
}

export interface DismissedExtractedTask {
  key: string;
  dismissedAt: string;
}

export interface DashboardCandidateTask {
  kind: "candidate";
  text: string;
  dueDate: string | null;
  category: string;
  priority: string;
  timeEstimateMin: number;
  source: "moments" | "notes";
  sourceLabel: string;
  existsAlready: boolean;
  extractRunAt?: string;
}

export interface ExtractedTaskFilterResult {
  visibleTasks: DashboardCandidateTask[];
  hiddenExisting: number;
  hiddenDismissed: number;
  hiddenDuplicates: number;
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

export type DashboardTaskSection =
  | "overdue"
  | "today"
  | "upcoming"
  | "scheduled"
  | "backlog"
  | "unsorted"
  | "done";

export type DashboardListFilter =
  | "all"
  | "today"
  | "planned"
  | "done"
  | DashboardTaskSection;

export interface DashboardTaskView extends DashTask {
  kind: "task";
  relativePath: string;
  effectiveDate: string | null;
  section: DashboardTaskSection;
}

export interface DashboardCandidateView extends DashboardCandidateTask {
  extractionIndex: number;
  order?: number;
  added?: boolean;
}

export type DashboardListItem = DashboardTaskView | DashboardCandidateView;

export interface DashboardListSectionView {
  key: DashboardListFilter | "candidates";
  title: string;
  items: DashboardListItem[];
}

export interface DashboardListViewModel {
  sections: DashboardListSectionView[];
  flatItems?: DashboardListItem[];
  emptyMessage: string | null;
}

const DASHBOARD_EMPTY_MESSAGE_SEPARATOR = "||";

function buildDashboardEmptyMessage(filter: DashboardListFilter): string {
  switch (filter) {
    case "all":
      return `No tasks yet${DASHBOARD_EMPTY_MESSAGE_SEPARATOR}Use Quick Add or AI Extract to create your first task.`;
    default:
      return "No items in this filter";
  }
}

export interface DashboardCandidateStateMigration {
  candidateTasks: DashboardCandidateView[];
  candidateOrderSeed: number;
  addedCandidateKeys: string[];
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
    category: typeof task.category === "string" && task.category.trim().length > 0 ? task.category : "other",
    priority: typeof task.priority === "string" && task.priority.trim().length > 0 ? task.priority : "medium",
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

function normalizeDashboardCandidateTaskForSource(
  value: unknown,
  fallbackSource: DashboardCandidateTask["source"],
): DashboardCandidateTask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const task = value as Partial<DashboardCandidateTask> & { sourceNote?: unknown };
  const normalizedTask = normalizeDashboardCandidateTask(task);
  if (!normalizedTask) {
    return null;
  }

  const legacySourceLabel =
    typeof task.sourceLabel === "string" && task.sourceLabel.trim().length > 0
      ? task.sourceLabel
      : typeof task.sourceNote === "string" && task.sourceNote.trim().length > 0
        ? task.sourceNote
        : fallbackSource === "notes"
          ? "Notes"
          : "Moments";

  return {
    ...normalizedTask,
    source: fallbackSource,
    sourceLabel: legacySourceLabel,
  };
}

interface DashboardCandidateAddAck {
  requestId: string | null;
  status: "added" | "exists";
}

interface DashboardSummary {
  totalOpen: number;
  attentionCount: number;
  overdueCount: number;
  totalDone: number;
  completionRate: number;
}

interface DashboardData {
  today: string;
  tasks: DashboardTaskView[];
  week: WeekDay[];
  catCount: Record<string, number>;
  sectionCounts: Record<DashboardTaskSection, number>;
  summary: DashboardSummary;
}

// ---------------------------------------------------------------------------
// File-based task collection (VS Code extension can't use bun:sqlite)
// ---------------------------------------------------------------------------

const TASK_RE = /^- \[([ xX])\] (.+)$/;
const TAG_RE = /#[\w\u3040-\u9FFF\u4E00-\u9FFF-]+/g;
const DUE_DATE_RE = /(?:📅|due:|@)(\d{4}-\d{2}-\d{2})/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXTRACTED_TASK_DISMISS_WINDOW_DAYS = 30;
const MAX_DISMISSED_EXTRACTED_TASKS = 200;
const SECTION_ORDER: Record<DashboardTaskSection, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  scheduled: 3,
  backlog: 4,
  unsorted: 5,
  done: 6,
};
const ATTENTION_SECTIONS = new Set<DashboardTaskSection>(["overdue", "today", "upcoming"]);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayDateString(): string {
  return formatDateString(new Date());
}

function isIsoDateString(value: string | null | undefined): value is string {
  return Boolean(value && ISO_DATE_RE.test(value));
}

function normalizeOptionalDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_RE.test(value) ? value : null;
}

function dateFromFilePath(filePath: string): string | null {
  const m = path.basename(filePath, ".md").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function getRelativePathFromTaskId(taskId: string, fallbackFilePath: string): string {
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

export function normalizeDashboardTaskText(text: string): string {
  return sanitizeTaskInputText(text);
}

export function normalizeExtractedTaskIdentity(text: string): string {
  return stripDashboardDueDate(text).normalize("NFKC").toLowerCase();
}

export function stripDashboardDueDate(text: string): string {
  return sanitizeTaskInputText(text)
    .replace(/\s*(?:📅|due:|@)(\d{4}-\d{2}-\d{2})\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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

function ensureDashboardTaskFile(notesDir: string, targetDate: string | null): string {
  const filePath = resolveDashboardTaskFile(notesDir, targetDate);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buildTaskFileHeader(targetDate), "utf8");
  }

  return filePath;
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const resolvedParent = path.resolve(parentDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  );
}

function resolveTaskRef(
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

function buildTaskMarkdownLine(done: boolean, text: string): string {
  return `- [${done ? "x" : " "}] ${text}`;
}

function shiftDate(baseDate: string, days: number): string {
  const d = new Date(`${baseDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDateString(d);
}

function normalizeDismissedExtractedTasks(value: unknown): DismissedExtractedTask[] {
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

function pruneDismissedExtractedTasks(
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
  let hiddenExisting = 0;
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
    hiddenExisting,
    hiddenDismissed,
    hiddenDuplicates,
  };
}

function buildExtractedTaskStatusMessage(result: ExtractedTaskFilterResult): string {
  const hiddenParts: string[] = [];
  if (result.hiddenExisting > 0) {
    hiddenParts.push(`${result.hiddenExisting}件は既存タスクと重複`);
  }
  if (result.hiddenDismissed > 0) {
    hiddenParts.push(`${result.hiddenDismissed}件は一時非表示`);
  }
  if (result.hiddenDuplicates > 0) {
    hiddenParts.push(`${result.hiddenDuplicates}件は候補内で重複`);
  }

  if (result.visibleTasks.length === 0) {
    return hiddenParts.length > 0
      ? `新しい候補はありません。${hiddenParts.join("、")}として除外しました。`
      : "実行可能なタスクは見つかりませんでした。";
  }

  return hiddenParts.length > 0
    ? `${result.visibleTasks.length}件の候補を表示しています。${hiddenParts.join("、")}として除外しました。`
    : `${result.visibleTasks.length}件の候補を表示しています。`;
}

function buildExtractedTaskFailureMessage(reason: ExtractTasksFailureReason): string {
  if (reason === "modelUnavailable") {
    return "AI 抽出を実行できませんでした。GitHub Copilot Chat の利用状態を確認してください。";
  }

  if (reason === "requestFailed") {
    return "AI 抽出に失敗しました。少し待ってからもう一度お試しください。";
  }

  return "実行可能なタスクは見つかりませんでした。";
}

export function collectTasksFromNotes(notesDir: string, momentsSubfolder = "moments"): DashTask[] {
  const tasks: DashTask[] = [];
  const momentsAbsPath = path.resolve(notesDir, momentsSubfolder);

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) === momentsAbsPath) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const date = dateFromFilePath(fullPath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      const relPath = path.relative(notesDir, fullPath);
      for (let i = 0; i < lines.length; i++) {
        const match = TASK_RE.exec(lines[i]);
        if (!match) {
          continue;
        }

        const text = match[2].trim();
        const tags = [...new Set(text.match(TAG_RE) ?? [])];
        const dueDateMatch = DUE_DATE_RE.exec(text);
        tasks.push({
          id: `${relPath}:${i}`,
          filePath: fullPath,
          lineIndex: i,
          text,
          done: match[1].toLowerCase() === "x",
          date,
          dueDate: dueDateMatch ? dueDateMatch[1] : null,
          tags,
        });
      }
    }
  }

  walk(notesDir);
  return tasks;
}

export function buildUpcomingWeek(tasks: DashTask[], today = todayDateString()): WeekDay[] {
  const days: WeekDay[] = [];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < 7; i++) {
    const date = shiftDate(today, i);
    const d = new Date(`${date}T00:00:00`);
    days.push({
      date,
      label: labels[d.getDay()],
      open: 0,
      done: 0,
    });
  }

  const weekDaysByDate = new Map(days.map((day) => [day.date, day]));
  for (const task of tasks) {
    const effectiveDate = task.dueDate ?? task.date;
    if (!effectiveDate) {
      continue;
    }

    const day = weekDaysByDate.get(effectiveDate);
    if (!day) {
      continue;
    }

    if (task.done) {
      day.done++;
    } else {
      day.open++;
    }
  }

  return days;
}

export function classifyDashboardTask(
  task: DashTask,
  today: string,
  horizonDate: string,
): DashboardTaskSection {
  if (task.done) {
    return "done";
  }

  const effectiveDate = task.dueDate ?? task.date;
  if (!effectiveDate) {
    return "backlog";
  }

  if (effectiveDate < today) {
    return "overdue";
  }

  if (effectiveDate === today) {
    return "today";
  }

  if (effectiveDate <= horizonDate) {
    return "upcoming";
  }

  return "scheduled";
}

function compareDashboardTasks(a: DashboardTaskView, b: DashboardTaskView): number {
  const sectionDiff = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
  if (sectionDiff !== 0) {
    return sectionDiff;
  }

  if (a.done !== b.done) {
    return a.done ? 1 : -1;
  }

  const aDate = a.effectiveDate ?? "";
  const bDate = b.effectiveDate ?? "";
  if (aDate && bDate && aDate !== bDate) {
    return a.section === "done" ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
  }

  if (aDate && !bDate) {
    return -1;
  }

  if (!aDate && bDate) {
    return 1;
  }

  const pathDiff = a.relativePath.localeCompare(b.relativePath);
  if (pathDiff !== 0) {
    return pathDiff;
  }

  return a.text.localeCompare(b.text);
}

export function buildDashboardTaskViews(tasks: DashTask[], today: string): DashboardTaskView[] {
  const horizonDate = shiftDate(today, 7);
  return tasks
    .map((task): DashboardTaskView => {
      const relativePath = getRelativePathFromTaskId(task.id, task.filePath);
      const effectiveDate = task.dueDate ?? task.date;
      return {
        ...task,
        kind: "task",
        relativePath,
        effectiveDate,
        section: classifyDashboardTask(task, today, horizonDate),
      };
    })
    .sort(compareDashboardTasks);
}

export function buildDashboardCandidateViews(
  tasks: DashboardCandidateTask[],
): DashboardCandidateView[] {
  return tasks.map((task, extractionIndex) => ({
    ...task,
    extractionIndex,
  }));
}

export function buildDashboardListItems(
  tasks: DashboardTaskView[],
  candidates: DashboardCandidateView[],
): DashboardListItem[] {
  return [...tasks, ...candidates];
}

export function matchesDashboardListItemFilter(
  item: DashboardListItem,
  filter: DashboardListFilter,
): boolean {
  if (filter === "all") {
    return true;
  }

  if (item.kind === "candidate") {
    return false;
  }

  if (filter === "today") {
    return item.section === "overdue" || item.section === "today";
  }

  if (filter === "planned") {
    return item.section === "upcoming" || item.section === "scheduled";
  }

  if (filter === "done") {
    return item.section === "done";
  }

  return item.section === filter;
}

export function countDashboardListItemsForFilter(
  items: DashboardListItem[],
  filter: DashboardListFilter,
): number {
  return items.filter((item) => matchesDashboardListItemFilter(item, filter)).length;
}

function matchesDashboardListItemSearch(item: DashboardListItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    item.kind === "candidate"
      ? [
          item.text,
          item.sourceLabel,
          item.source,
          item.category,
          item.priority,
          item.dueDate ?? "",
          item.existsAlready ? "already exists" : "",
          "candidate",
        ]
      : [item.text, item.relativePath, item.date ?? "", item.dueDate ?? "", ...(item.tags || [])];

  return haystack.join(" ").toLowerCase().includes(normalizedQuery);
}

export function buildDashboardListViewModel(
  items: DashboardListItem[],
  filter: DashboardListFilter,
  search: string,
): DashboardListViewModel {
  const normalizedSearch = search.trim();
  const filteredItems = items.filter((item) => matchesDashboardListItemFilter(item, filter));
  const visibleItems = filteredItems.filter((item) => matchesDashboardListItemSearch(item, search));
  if (filter === "all") {
    if (normalizedSearch && visibleItems.length === 0) {
      return { sections: [], emptyMessage: "No search results" };
    }

    if (!normalizedSearch && filteredItems.length === 0) {
      return { sections: [], emptyMessage: buildDashboardEmptyMessage("all") };
    }

    const sections: DashboardListSectionView[] = [];

    const simplifiedSectionOrder: Array<"today" | "planned" | "unsorted" | "done"> = ["today", "planned", "unsorted", "done"];
    const simplifiedSectionTitles: Record<string, string> = {
      today: "Today",
      planned: "Planned",
      unsorted: "Unsorted",
      done: "Done",
    };

    for (const simplifiedSection of simplifiedSectionOrder) {
      let internalSections: DashboardTaskSection[];
      if (simplifiedSection === "today") {
        internalSections = ["overdue", "today"];
      } else if (simplifiedSection === "planned") {
        internalSections = ["upcoming", "scheduled"];
      } else if (simplifiedSection === "unsorted") {
        internalSections = ["backlog"];
      } else {
        internalSections = ["done"];
      }

      const taskItems = visibleItems.filter(
        (item): item is DashboardTaskView => item.kind === "task" && internalSections.includes(item.section),
      );
      if (!normalizedSearch || taskItems.length > 0) {
        sections.push({
          key: simplifiedSection,
          title: simplifiedSectionTitles[simplifiedSection],
          items: taskItems,
        });
      }
    }

    return { sections, emptyMessage: null };
  }

  if (filteredItems.length === 0) {
    return { sections: [], emptyMessage: buildDashboardEmptyMessage(filter) };
  }

  if (visibleItems.length === 0) {
    return {
      sections: [],
      emptyMessage: normalizedSearch ? "No search results" : buildDashboardEmptyMessage(filter),
    };
  }

  const simplifiedSectionTitles: Record<string, string> = {
    today: "Today",
    planned: "Planned",
    unsorted: "Unsorted",
    done: "Done",
  };
  const title = simplifiedSectionTitles[filter] || filter[0].toUpperCase() + filter.slice(1);

  return {
    sections: [],
    flatItems: visibleItems,
    emptyMessage: null,
  };
}

export function migrateDashboardCandidateState(savedState: {
  candidateTasks?: unknown;
  candidateOrderSeed?: unknown;
  addedCandidateKeys?: unknown;
  extractedTasks?: unknown;
  notesExtractedTasks?: unknown;
  addedExtractedKeys?: unknown;
  notesAddedExtractedKeys?: unknown;
}): DashboardCandidateStateMigration {
  if (Array.isArray(savedState.candidateTasks)) {
    const candidateTasks = savedState.candidateTasks
      .map((task): DashboardCandidateView | null => {
        const normalizedTask = normalizeDashboardCandidateTask(task);
        if (!normalizedTask) {
          return null;
        }

        const candidate = task as Partial<DashboardCandidateView>;
        return {
          ...normalizedTask,
          order: typeof candidate.order === "number" ? candidate.order : undefined,
          added: Boolean(candidate.added),
          extractionIndex:
            typeof candidate.extractionIndex === "number"
              ? candidate.extractionIndex
              : typeof candidate.order === "number"
                ? candidate.order
                : 0,
        };
      })
      .filter((task): task is DashboardCandidateView => task !== null);
    const maxOrder = candidateTasks.reduce((highest, task) => {
      return typeof task.order === "number" && task.order > highest ? task.order : highest;
    }, -1);
    return {
      candidateTasks,
      candidateOrderSeed:
        typeof savedState.candidateOrderSeed === "number"
          ? savedState.candidateOrderSeed
          : maxOrder + 1,
      addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
        ? (savedState.addedCandidateKeys as unknown[]).filter(
            (key): key is string => typeof key === "string" && key.length > 0,
          )
        : [],
    };
  }

  let nextOrder = 0;
  const fromMoments = (Array.isArray(savedState.extractedTasks) ? savedState.extractedTasks : []).map(
    (task): DashboardCandidateView | null => {
      const candidate = normalizeDashboardCandidateTaskForSource(task, "moments");
      if (!candidate) {
        return null;
      }

      return {
        ...candidate,
        order: nextOrder++,
        added: Array.isArray(savedState.addedExtractedKeys)
          ? savedState.addedExtractedKeys.includes(normalizeExtractedTaskIdentity(candidate.text))
          : false,
        extractionIndex: nextOrder - 1,
      };
    },
  ).filter((task): task is DashboardCandidateView => task !== null);
  const fromNotes = (Array.isArray(savedState.notesExtractedTasks)
    ? savedState.notesExtractedTasks
    : []
  ).map((task): DashboardCandidateView | null => {
    const candidate = normalizeDashboardCandidateTaskForSource(task, "notes");
    if (!candidate) {
      return null;
    }

    return {
      ...candidate,
      order: nextOrder++,
      added: Array.isArray(savedState.notesAddedExtractedKeys)
        ? savedState.notesAddedExtractedKeys.includes(normalizeExtractedTaskIdentity(candidate.text))
        : false,
      extractionIndex: nextOrder - 1,
    };
  }).filter((task): task is DashboardCandidateView => task !== null);

  return {
    candidateTasks: fromMoments.concat(fromNotes),
    candidateOrderSeed: nextOrder,
    addedCandidateKeys: (Array.isArray(savedState.addedExtractedKeys)
      ? (savedState.addedExtractedKeys as string[])
      : []
    ).concat(
      Array.isArray(savedState.notesAddedExtractedKeys)
        ? (savedState.notesAddedExtractedKeys as string[])
        : [],
    ),
  };
}

function buildSectionCounts(tasks: DashboardTaskView[]): Record<DashboardTaskSection, number> {
  const counts: Record<DashboardTaskSection, number> = {
    overdue: 0,
    today: 0,
    upcoming: 0,
    scheduled: 0,
    backlog: 0,
    unsorted: 0,
    done: 0,
  };

  for (const task of tasks) {
    counts[task.section]++;
  }

  return counts;
}

function buildCategoryCounts(tasks: DashboardTaskView[]): Record<string, number> {
  const categories = ["work", "personal", "health", "learning", "admin", "other"];
  const counts: Record<string, number> = {};
  for (const category of categories) {
    counts[category] = 0;
  }

  for (const task of tasks) {
    if (task.done) {
      continue;
    }

    let matched = false;
    for (const tag of task.tags) {
      const normalized = tag.replace("#", "").toLowerCase();
      if (normalized in counts && normalized !== "other") {
        counts[normalized]++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      counts.other++;
    }
  }

  return counts;
}

function buildSummary(
  tasks: DashboardTaskView[],
  sectionCounts: Record<DashboardTaskSection, number>,
): DashboardSummary {
  const totalDone = sectionCounts.done;
  const totalOpen = tasks.length - totalDone;
  const completionRate = tasks.length > 0 ? Math.round((totalDone / tasks.length) * 100) : 0;

  return {
    totalOpen,
    attentionCount: tasks.filter((task) => !task.done && ATTENTION_SECTIONS.has(task.section))
      .length,
    overdueCount: sectionCounts.overdue,
    totalDone,
    completionRate,
  };
}

// ---------------------------------------------------------------------------
// Dashboard Panel class
// ---------------------------------------------------------------------------

export class DashboardPanel {
  public static readonly viewType = "noteeeesDashboard";
  private static _instance: DashboardPanel | undefined;
  private static _statusListener: ((processing: boolean) => void) | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _getNotesDir: () => string | undefined;
  private readonly _stateStore: vscode.Memento;
  private _disposables: vscode.Disposable[] = [];
  private _cancelToken: vscode.CancellationTokenSource | undefined;

  static createOrShow(
    getNotesDir: () => string | undefined,
    extensionUri: vscode.Uri,
    stateStore: vscode.Memento,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel._instance) {
      DashboardPanel._instance._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      "Task Dashboard",
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    DashboardPanel._instance = new DashboardPanel(panel, getNotesDir, extensionUri, stateStore);
  }

  static refresh(): void {
    DashboardPanel._instance?._update();
  }

  static dispose(): void {
    DashboardPanel._instance?.dispose();
  }

  static setStatusListener(cb: (processing: boolean) => void): void {
    DashboardPanel._statusListener = cb;
  }

  static runAiExtract(): void {
    if (DashboardPanel._instance) {
      void DashboardPanel._instance._runAiExtract();
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    getNotesDir: () => string | undefined,
    _extensionUri: vscode.Uri,
    stateStore: vscode.Memento,
  ) {
    this._panel = panel;
    this._getNotesDir = getNotesDir;
    this._stateStore = stateStore;

    this._panel.webview.options = { enableScripts: true };
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (message: unknown) => this._handleMessage(message as Record<string, unknown>),
      null,
      this._disposables,
    );

    this._update();
  }

  private _getDismissedExtractedStorageKey(notesDir: string): string {
    const notesKey = crypto.createHash("sha1").update(path.resolve(notesDir)).digest("hex");
    return `dashboard.dismissedExtracted.${notesKey}`;
  }

  private _loadDismissedExtractedTasks(notesDir: string): DismissedExtractedTask[] {
    const storageKey = this._getDismissedExtractedStorageKey(notesDir);
    const entries = normalizeDismissedExtractedTasks(this._stateStore.get(storageKey, []));
    const pruned = pruneDismissedExtractedTasks(entries);

    if (pruned.length !== entries.length) {
      void this._stateStore.update(storageKey, pruned);
    }

    return pruned;
  }

  private _dismissExtractedTask(text: string): void {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const key = normalizeExtractedTaskIdentity(text);
    if (!key) {
      return;
    }

    const storageKey = this._getDismissedExtractedStorageKey(notesDir);
    const nextEntries = pruneDismissedExtractedTasks(
      this._loadDismissedExtractedTasks(notesDir)
        .filter((entry) => entry.key !== key)
        .concat([{ key, dismissedAt: todayDateString() }]),
    );
    void this._stateStore.update(storageKey, nextEntries);
  }

  private dispose(): void {
    DashboardPanel._instance = undefined;
    this._cancelToken?.cancel();
    this._panel.dispose();
    for (const disposable of this._disposables) {
      disposable.dispose();
    }
    this._disposables = [];
  }

  private _update(): void {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      this._panel.webview.html = this._getLoadingHtml(
        "Notes directory is not configured. Run Setup first.",
      );
      return;
    }

    const momentsSubfolder =
      vscode.workspace.getConfiguration("notes").get<string>("momentsSubfolder") || "moments";

    const tasks = collectTasksFromNotes(notesDir, momentsSubfolder);
    const today = todayDateString();
    const week = buildUpcomingWeek(tasks, today);

    const taskViews = buildDashboardTaskViews(tasks, today);
    const sectionCounts = buildSectionCounts(taskViews);
    const catCount = buildCategoryCounts(taskViews);
    const summary = buildSummary(taskViews, sectionCounts);

    this._panel.webview.html = this._getHtml({
      today,
      tasks: taskViews,
      week,
      catCount,
      sectionCounts,
      summary,
    });
  }

  private _handleMessage(message: Record<string, unknown>): void {
    switch (message.command) {
      case "refresh":
        this._update();
        return;

      case "toggleTask": {
        const { taskId, done } = message as { taskId: string; done: boolean };
        this._toggleTask(taskId, done);
        return;
      }

      case "openFile": {
        const { filePath, lineIndex } = message as { filePath: string; lineIndex: number };
        void this._openFile(filePath, lineIndex);
        return;
      }

      case "createTask": {
        const { text, dueDate, targetDate } = message as {
          text: string;
          dueDate?: string | null;
          targetDate?: string | null;
        };
        void this._createTask(text, normalizeOptionalDate(targetDate), normalizeOptionalDate(dueDate));
        return;
      }

      case "addExtractedTask": {
        const { text, dueDate, targetDate, requestId } = message as {
          text: string;
          dueDate?: string | null;
          targetDate?: string | null;
          requestId?: string | null;
        };
        void this._addExtractedTask({
          text,
          targetDate: normalizeOptionalDate(targetDate),
          dueDate: normalizeOptionalDate(dueDate),
          requestId: typeof requestId === "string" ? requestId : null,
        });
        return;
      }

      case "updateTask": {
        const { taskId, text, dueDate } = message as {
          taskId: string;
          text: string;
          dueDate?: string | null;
        };
        this._updateTask(taskId, text, normalizeOptionalDate(dueDate));
        return;
      }

      case "dismissExtractedTask": {
        const { text } = message as { text?: unknown };
        if (typeof text === "string") {
          this._dismissExtractedTask(text);
        }
        return;
      }

      case "deleteTask": {
        const { taskId } = message as { taskId: string };
        this._deleteTask(taskId);
        return;
      }

      case "aiExtract": {
        const { sourceDate } = message as { sourceDate?: string | null };
        void this._runAiExtract(normalizeOptionalDate(sourceDate));
        return;
      }

      case "extractFromNotes": {
        const { fromDate, toDate } = message as { fromDate: string; toDate: string };
        void this._extractFromNotes(fromDate, toDate);
        return;
      }
    }
  }

  private _toggleTask(taskId: string, done: boolean): void {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const ref = resolveTaskRef(notesDir, taskId);
    if (!ref || !fs.existsSync(ref.filePath)) {
      return;
    }

    const lines = fs.readFileSync(ref.filePath, "utf8").split("\n");
    const line = lines[ref.lineIndex];
    if (!line) {
      return;
    }

    const match = TASK_RE.exec(line);
    if (!match) {
      return;
    }

    lines[ref.lineIndex] = buildTaskMarkdownLine(done, match[2].trim());
    fs.writeFileSync(ref.filePath, lines.join("\n"), "utf8");
    this._update();
  }

  private _updateTask(taskId: string, text: string, dueDate: string | null): void {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const normalizedText = upsertDashboardDueDate(text, dueDate);
    if (!normalizedText) {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return;
    }

    const ref = resolveTaskRef(notesDir, taskId);
    if (!ref || !fs.existsSync(ref.filePath)) {
      return;
    }

    const lines = fs.readFileSync(ref.filePath, "utf8").split("\n");
    const line = lines[ref.lineIndex];
    if (!line) {
      return;
    }

    const match = TASK_RE.exec(line);
    if (!match) {
      return;
    }

    lines[ref.lineIndex] = buildTaskMarkdownLine(match[1].toLowerCase() === "x", normalizedText);
    fs.writeFileSync(ref.filePath, lines.join("\n"), "utf8");
    this._update();
  }

  private _deleteTask(taskId: string): void {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const ref = resolveTaskRef(notesDir, taskId);
    if (!ref || !fs.existsSync(ref.filePath)) {
      return;
    }

    const lines = fs.readFileSync(ref.filePath, "utf8").split("\n");
    const line = lines[ref.lineIndex];
    if (!line || !TASK_RE.exec(line)) {
      return;
    }

    lines.splice(ref.lineIndex, 1);
    fs.writeFileSync(ref.filePath, lines.join("\n"), "utf8");
    this._update();
  }

  private async _createTask(
    text: string,
    targetDate: string | null,
    dueDate: string | null,
  ): Promise<boolean> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return false;
    }

    const normalizedText = upsertDashboardDueDate(text, dueDate);
    if (!normalizedText) {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return false;
    }

    const taskFile = ensureDashboardTaskFile(notesDir, targetDate);
    const existing = fs.readFileSync(taskFile, "utf8");
    const prefix = existing.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(
      taskFile,
      `${existing}${prefix}${buildTaskMarkdownLine(false, normalizedText)}\n`,
      "utf8",
    );

    this._update();
    return true;
  }

  private _hasExistingExtractedTask(notesDir: string, text: string): boolean {
    const targetKey = normalizeExtractedTaskIdentity(text);
    if (!targetKey) {
      return false;
    }

    return collectTasksFromNotes(notesDir).some(
      (task) => normalizeExtractedTaskIdentity(task.text) === targetKey,
    );
  }

  private async _addExtractedTask({
    text,
    targetDate,
    dueDate,
    requestId,
  }: {
    text: string;
    targetDate: string | null;
    dueDate: string | null;
    requestId: string | null;
  }): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      this._postCandidateAddFailed(requestId, "Notes directory is not configured.");
      return;
    }

    if (this._hasExistingExtractedTask(notesDir, text)) {
      this._update();
      this._postCandidateAddResult({ requestId, status: "exists" });
      return;
    }

    try {
      const created = await this._createTask(text, targetDate, dueDate);
      if (!created) {
        this._postCandidateAddFailed(requestId, "Task text cannot be empty.");
        return;
      }

      this._postCandidateAddResult({ requestId, status: "added" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add candidate task.";
      void vscode.window.showErrorMessage(message);
      this._postCandidateAddFailed(requestId, message);
    }
  }

  private _postCandidateAddResult(result: DashboardCandidateAddAck): void {
    void this._panel.webview.postMessage({
      type: "candidateAddResult",
      requestId: result.requestId,
      status: result.status,
    });
  }

  private _postCandidateAddFailed(requestId: string | null, message: string): void {
    void this._panel.webview.postMessage({
      type: "candidateAddFailed",
      requestId,
      message,
    });
  }

  private async _openFile(filePath: string, lineIndex: number): Promise<void> {
    if (!fs.existsSync(filePath)) {
      return;
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    const position = new vscode.Position(lineIndex, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }

  private async _runAiExtract(sourceDate?: string | null): Promise<void> {
    this._cancelToken?.cancel();
    this._cancelToken = new vscode.CancellationTokenSource();
    const token = this._cancelToken.token;
    const targetDate = sourceDate ?? todayDateString();

    DashboardPanel._statusListener?.(true);
    void this._panel.webview.postMessage({
      type: "aiStatus",
      status: "processing",
      message: `${targetDate} の Moments を分析しています...`,
    });

    try {
      const notesDir = this._getNotesDir();
      if (!notesDir) {
        return;
      }

      const momentsSubfolder =
        vscode.workspace.getConfiguration("notes").get<string>("momentsSubfolder") || "moments";
      const momentsFile = path.join(notesDir, momentsSubfolder, `${targetDate}.md`);

      if (!fs.existsSync(momentsFile)) {
        void this._panel.webview.postMessage({
          type: "aiStatus",
          status: "error",
          message: `${targetDate} の Moments ファイルが見つかりません。`,
        });
        return;
      }

      const content = fs.readFileSync(momentsFile, "utf8");
      const body = content.replace(/^---[\s\S]*?---\s*/m, "").trim();
      const cleanText = body
        .split("\n")
        .filter((line) => line.startsWith("- "))
        .map((line) => line.replace(/^- (\d{2}:\d{2} )?/, "").trim())
        .filter(Boolean)
        .join("\n");

      if (!cleanText) {
        void this._panel.webview.postMessage({
          type: "aiStatus",
          status: "error",
          message: `${targetDate} の Moments に抽出対象のテキストがありません。`,
        });
        return;
      }

      const extractionResult = await extractTasksFromTextWithStatus(cleanText, token);
      const extracted = extractionResult.tasks;
      const existingTasks = collectTasksFromNotes(notesDir, momentsSubfolder);
      const filtered = filterExtractedTasksForDisplay(
        extracted,
        existingTasks,
        this._loadDismissedExtractedTasks(notesDir),
      );

      if (filtered.visibleTasks.length === 0) {
        void this._panel.webview.postMessage({
          type: "aiStatus",
          status: "done",
          message:
            extractionResult.failureReason !== null
              ? buildExtractedTaskFailureMessage(extractionResult.failureReason)
              : buildExtractedTaskStatusMessage(filtered),
        });
        return;
      }

      void this._panel.webview.postMessage({
        type: "aiStatus",
        status: "done",
        message: buildExtractedTaskStatusMessage(filtered),
      });
      void this._panel.webview.postMessage({ type: "extractResult", tasks: filtered.visibleTasks });
    } finally {
      DashboardPanel._statusListener?.(false);
    }
  }

  private async _extractFromNotes(fromDate: string, toDate: string): Promise<void> {
    this._cancelToken?.cancel();
    this._cancelToken = new vscode.CancellationTokenSource();
    const token = this._cancelToken.token;

    DashboardPanel._statusListener?.(true);
    void this._panel.webview.postMessage({
      type: "notesAiStatus",
      status: "processing",
      message: `${fromDate} ～ ${toDate} のノートを分析しています...`,
    });

    try {
      const notesDir = this._getNotesDir();
      if (!notesDir) {
        return;
      }

      // Collect notes by date using direct file reading (fallback method)
      const noteContents = await this._collectNotesByDate(fromDate, toDate);

      if (noteContents.length === 0) {
        void this._panel.webview.postMessage({
          type: "notesAiStatus",
          status: "error",
          message: `${fromDate} ～ ${toDate} の期間に該当するノートが見つかりません。`,
        });
        return;
      }

      const momentsSubfolder =
        vscode.workspace.getConfiguration("notes").get<string>("momentsSubfolder") || "moments";
      const extracted = await extractTasksFromNotes(noteContents, token);
      const existingTasks = collectTasksFromNotes(notesDir, momentsSubfolder);
      const filtered = filterExtractedTasksForDisplay(
        extracted,
        existingTasks,
        this._loadDismissedExtractedTasks(notesDir),
      );

      if (filtered.visibleTasks.length === 0) {
        void this._panel.webview.postMessage({
          type: "notesAiStatus",
          status: "done",
          message: buildExtractedTaskStatusMessage(filtered),
        });
        return;
      }

      void this._panel.webview.postMessage({
        type: "notesAiStatus",
        status: "done",
        message: `${noteContents.length}件のノートから${filtered.visibleTasks.length}件のタスク候補を抽出しました。`,
      });
      void this._panel.webview.postMessage({ type: "notesExtractResult", tasks: filtered.visibleTasks });
    } finally {
      DashboardPanel._statusListener?.(false);
    }
  }

  private async _collectNotesByDate(fromDate: string, toDate: string): Promise<NoteContent[]> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return [];
    }

    const results: NoteContent[] = [];

    const collectFiles = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip moments directory to avoid duplicate extraction
          if (entry.name !== "moments") {
            collectFiles(fullPath);
          }
        } else if (entry.name.endsWith(".md")) {
          // Extract date from filename
          const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const fileDate = dateMatch[1];
            if (fileDate >= fromDate && fileDate <= toDate) {
              try {
                const content = fs.readFileSync(fullPath, "utf8");
                results.push({
                  filename: path.relative(notesDir, fullPath),
                  title: entry.name.replace(/\.md$/, ""),
                  content,
                  createdAt: fileDate,
                });
              } catch (e) {
                // Skip files that can't be read
              }
            }
          }
        }
      }
    };

    collectFiles(notesDir);
    return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  private _getLoadingHtml(message: string): string {
    return `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)"><p>${escHtml(
      message,
    )}</p></body></html>`;
  }

  private _getHtml(data: DashboardData): string {
    const nonce = crypto.randomBytes(16).toString("hex");
    const weekMax = Math.max(...data.week.map((day) => day.open + day.done), 1);
    const payload = toScriptData(data);

    const weekBarsHtml = data.week
      .map((day) => {
        const total = day.open + day.done;
        const openHeight = total > 0 ? Math.round((day.open / weekMax) * 100) : 0;
        const doneHeight = total > 0 ? Math.round((day.done / weekMax) * 100) : 0;
        const isToday = day.date === data.today;
        const [, month, dateOfMonth] = day.date.split("-");
        const label = `${Number.parseInt(month, 10)}/${Number.parseInt(dateOfMonth, 10)}`;
        const title = `${day.date} · open ${day.open} · done ${day.done}`;
        return `<div class="week-day${isToday ? " is-today" : ""}" title="${escAttr(title)}">
  <div class="week-day-bars" data-zero="${total === 0}">
    <div class="week-bar week-bar-open${day.open === 0 ? " is-zero" : ""}" style="height:${openHeight}%"></div>
    <div class="week-bar week-bar-done${day.done === 0 ? " is-zero" : ""}" style="height:${doneHeight}%"></div>
  </div>
  <div class="week-day-label">
    <span>${escHtml(day.label)}</span>
    <strong>${escHtml(label)}</strong>
  </div>
</div>`;
      })
      .join("");

    const categoryOrder = ["work", "personal", "health", "learning", "admin", "other"];
    const categoryLabels: Record<string, string> = {
      work: "Work",
      personal: "Personal",
      health: "Health",
      learning: "Learning",
      admin: "Admin",
      other: "Other",
    };
    const categoryIcons: Record<string, string> = {
      work: "W",
      personal: "P",
      health: "H",
      learning: "L",
      admin: "A",
      other: "O",
    };
    const categoryMax = Math.max(...categoryOrder.map((key) => data.catCount[key] ?? 0), 1);
    const categoryHtml = categoryOrder
      .map((key) => {
        const count = data.catCount[key] ?? 0;
        const width = Math.max(count === 0 ? 0 : Math.round((count / categoryMax) * 100), count > 0 ? 12 : 0);
        return `<div class="category-row">
  <div class="category-label"><span class="category-icon">${escHtml(categoryIcons[key])}</span>${escHtml(
          categoryLabels[key],
        )}</div>
  <div class="category-track" data-empty="${count === 0}"><div class="category-fill${count === 0 ? " is-zero" : ""}" style="width:${width}%"></div></div>
  <div class="category-count">${count}</div>
</div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Task Dashboard</title>
<style nonce="${nonce}">
  :root {
    --bg: var(--vscode-editor-background, #111827);
    --surface: var(--vscode-editorWidget-background, #161b22);
    --border: var(--vscode-panel-border, #2d3748);
    --text: var(--vscode-foreground, #dbe2ea);
    --muted: var(--vscode-descriptionForeground, #8b98a5);
    --accent: var(--vscode-textLink-foreground, #4f8cff);
    --success: var(--vscode-testing-iconPassed, #2ea043);
    --warning: var(--vscode-editorWarning-foreground, #d97706);
    --danger: var(--vscode-errorForeground, #dc2626);
    --radius: 12px;
    --radius-sm: 8px;
    --gap: 16px;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 20px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.5;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 1320px;
    margin: 0 auto;
  }

  .dashboard-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  }

  .header-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .eyebrow {
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .header-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .header-right {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    align-items: center;
  }

  .dashboard-date-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    background: color-mix(in srgb, var(--surface) 60%, transparent);
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .dashboard-date-label {
    color: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .dashboard-weekday-marker {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .dashboard-kpi-row {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

   .dashboard-kpi-chip {
     display: inline-flex;
     align-items: center;
     gap: 8px;
     min-height: 32px;
     padding: 0 10px;
     border-radius: 999px;
     border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
     background: color-mix(in srgb, var(--surface) 68%, transparent);
     color: var(--text);
     cursor: default;
   }

  .dashboard-kpi-label {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .dashboard-kpi-value {
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .dashboard-kpi-note {
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .dashboard-toolbar,
  .dashboard-action-bar,
  .list-surface,
  .analytics-strip,
  .analytics-panel {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 56%, transparent);
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .card-header h2,
  .card-header h3 {
    margin: 4px 0 0;
    font-size: 14px;
    line-height: 1.3;
  }

  .card-header p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 12px;
  }

  .card-header .eyebrow {
    font-size: 10px;
  }

  .dashboard-toolbar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 9px 12px;
  }

  .dashboard-action-bar {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 10px;
    padding: 10px 12px;
  }

  .action-panel {
    min-width: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
    background: color-mix(in srgb, var(--surface) 38%, transparent);
  }

  .action-panel-quick-add,
  .action-panel-ai-extract {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .list-surface {
    padding: 10px 12px;
  }

  .candidate-block {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 56%, transparent);
    padding: 10px 12px;
  }

  .candidate-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .candidate-block-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
    color: var(--vscode-errorForeground, var(--text));
    font-size: 12px;
    line-height: 1.4;
  }

  .candidate-block-error-text {
    flex: 1;
    min-width: 0;
  }

  .candidate-block-error-dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
  }

  .candidate-block-error-dismiss:hover {
    opacity: 1;
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .filter-chip:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }

  .filter-chip.is-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--accent);
  }

  .filter-chip strong {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .search-shell {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: var(--radius-sm);
    padding: 0 12px;
    min-height: 38px;
    background: color-mix(in srgb, var(--surface) 34%, transparent);
  }

  .search-shell span {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .search-shell input {
    border: none;
    background: transparent;
    color: var(--text);
    width: 100%;
    min-width: 0;
    outline: none;
    padding: 10px 0;
  }

  .dashboard-main-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  .task-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .task-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .task-section-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .task-section-header span {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .task-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .task-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    background: color-mix(in srgb, var(--surface) 90%, var(--bg));
    min-width: 0;
  }

  .task-row.task-row-saved.is-overdue {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }

  .task-row.task-row-saved.is-today {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  .task-row.task-row-saved.is-done {
    opacity: 0.76;
  }

  .task-row.task-row-candidate {
    background: color-mix(in srgb, var(--surface) 84%, var(--bg));
  }

  .task-row.task-row-candidate.is-candidate-blocked {
    opacity: 0.8;
  }

  .task-row-toggle-entry,
  .task-row-leading {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .task-row-toggle-entry {
    width: 18px;
    height: 18px;
  }

  .task-row-toggle {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    margin: 0;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    background: transparent;
    cursor: pointer;
  }

  .task-row-toggle:checked {
    background: color-mix(in srgb, var(--success) 16%, transparent);
    border-color: color-mix(in srgb, var(--success) 55%, var(--border));
  }

  .task-row-toggle:checked::after {
    content: "";
    position: absolute;
    inset: 4px;
    background: var(--success);
    clip-path: polygon(14% 52%, 0 67%, 39% 100%, 100% 22%, 84% 8%, 39% 68%);
  }

  .task-row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .task-row-main {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }

  .task-row-title-entry {
    flex: 1;
    min-width: 0;
  }

  .task-row-title {
    margin: 0;
    border: none;
    padding: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    cursor: pointer;
    min-width: 0;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-row-saved .task-row-title:hover {
    color: var(--accent);
  }

  .task-row-candidate .task-row-title {
    cursor: default;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .task-row.task-row-saved.is-done .task-row-title {
    color: var(--muted);
    text-decoration: line-through;
  }

  .task-row-secondary-actions,
  .task-row-candidate-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .task-row-secondary-actions {
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out;
  }

  .task-row:hover .task-row-secondary-actions,
  .task-row:focus-within .task-row-secondary-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .link-btn,
  .text-btn,
  .btn {
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    padding: 8px 12px;
  }

  .btn {
    border-radius: var(--radius-sm);
    font-weight: 600;
  }

  .btn-primary {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    color: var(--accent);
  }

  .btn-danger {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
    color: var(--danger);
  }

  .btn:disabled,
  .text-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .text-btn,
  .link-btn {
    padding: 5px 9px;
    font-size: 12px;
    color: var(--muted);
  }

  .text-btn:hover,
  .link-btn:hover,
  .btn:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }

  .text-btn.is-danger:hover {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    color: var(--danger);
  }

  .task-row-meta {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .task-row-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex-shrink: 0;
  }

  .task-row-meta-source {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
  }

  .badge.is-accent {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .badge.is-success {
    color: var(--success);
    border-color: color-mix(in srgb, var(--success) 40%, var(--border));
    background: color-mix(in srgb, var(--success) 12%, transparent);
  }

  .badge.is-warning {
    color: var(--warning);
    border-color: color-mix(in srgb, var(--warning) 40%, var(--border));
    background: color-mix(in srgb, var(--warning) 12%, transparent);
  }

  .badge.is-danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .task-edit {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .task-edit .field,
  .task-edit .field-compact {
    margin-bottom: 0;
  }

  .composer-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .composer-body .field,
  .composer-body .field-compact {
    margin-bottom: 0;
  }

  .composer-body .helper {
    margin: 0;
  }

  .field,
  .field-compact {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    margin-bottom: 12px;
  }

  .field span,
  .field-compact span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .field input,
  .field textarea,
  .field-compact input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    color: var(--text);
    padding: 10px 12px;
    outline: none;
  }

  .field textarea {
    resize: vertical;
    min-height: 92px;
  }

  .field input:focus,
  .field textarea:focus,
  .field-compact input:focus {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .inline-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .extract-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .action-bar-extract-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .extract-group-label {
    color: var(--muted);
    display: block;
    font-size: 12px;
    font-weight: 600;
  }

  .extract-range-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .extract-submit-row {
    display: flex;
  }

  .extract-submit-row .btn {
    min-width: 116px;
  }

  .extract-date-input {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    color: var(--text);
    padding: 6px 10px;
    outline: none;
    font-family: inherit;
    font-size: 13px;
  }

  .extract-date-input:focus {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .extract-range-separator {
    color: var(--muted);
    flex-shrink: 0;
  }

  .inline-fields {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .inline-fields .field-compact {
    flex: 1;
    min-width: 120px;
  }

  .helper {
    color: var(--muted);
    font-size: 12px;
    text-wrap: pretty;
  }

  .mono {
    font-variant-numeric: tabular-nums;
  }

  .empty-state {
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    color: var(--muted);
    text-align: center;
    max-width: 420px;
    margin: 4px auto;
  }

  .empty-state-title {
    display: block;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .empty-state-body {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }

  .analytics-strip {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
    gap: 10px;
    align-items: start;
    padding: 8px 10px;
  }

  .analytics-panel {
    padding: 8px 10px;
  }

  .week-chart,
  .week-chart-compact {
    display: flex;
    gap: 8px;
    align-items: stretch;
    height: 108px;
  }

  .week-day {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 6px;
  }

  .week-day-bars {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 3px;
    padding: 5px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    border: 1px solid var(--border);
  }

  .week-day-bars[data-zero="true"] {
    opacity: 0.88;
  }

  .week-day.is-today .week-day-bars {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .week-bar {
    width: 100%;
    border-radius: 999px;
    min-height: 6px;
  }

  .week-bar.is-zero {
    opacity: 0.38;
  }

  .week-bar-open {
    background: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .week-bar-done {
    background: color-mix(in srgb, var(--success) 60%, transparent);
  }

  .week-day-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    color: var(--muted);
    font-size: 11px;
  }

  .week-day-label strong {
    color: var(--text);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .chart-legend {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    display: inline-block;
    margin-right: 6px;
    vertical-align: middle;
  }

  .category-list,
  .category-list-compact {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .category-row {
    display: grid;
    grid-template-columns: minmax(96px, auto) minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }

  .category-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .category-icon {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
  }

  .category-track {
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--surface) 84%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
  }

  .category-fill {
    height: 100%;
    min-width: 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 70%, transparent);
  }

  .category-fill.is-zero {
    opacity: 0.35;
  }

  .category-count {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .status-line {
    min-height: 20px;
    color: var(--muted);
    font-size: 12px;
    margin-top: 10px;
  }

  .status-line.is-error {
    color: var(--danger);
  }

  .ai-result {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
  }

  .extract-item {
    padding: 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
  }

  .extract-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .extract-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .extract-title {
    font-weight: 600;
    font-size: 13px;
  }

  .extract-meta {
    color: var(--muted);
    font-size: 12px;
  }

  @media (width < 1000px) {
    .dashboard-action-bar {
      grid-template-columns: 1fr;
    }

    .analytics-strip {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    body {
      padding: 14px;
    }

    .dashboard-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-right,
    .dashboard-kpi-row {
      justify-content: flex-start;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }

    .extract-range-row {
      flex-direction: column;
      align-items: stretch;
    }

    .extract-range-separator {
      display: none;
    }

    .task-row-main,
    .extract-head {
      flex-direction: column;
    }

    .task-row-secondary-actions,
    .task-row-candidate-actions {
      justify-content: flex-start;
    }

    .task-row-secondary-actions {
      opacity: 1;
      pointer-events: auto;
    }

    .dashboard-toolbar,
    .dashboard-action-bar,
    .list-surface,
    .analytics-strip {
      padding: 12px;
    }

    .dashboard-weekday-marker {
      display: none;
    }
  }
</style>
</head>
<body>
  <div class="page">
    <header class="dashboard-header" id="dashboard-header">
      <div class="header-copy">
        <h1 class="header-title">Task Dashboard</h1>
      </div>
      <div class="header-right" id="dashboard-header-right">
        <div class="dashboard-date-group">
          <span class="dashboard-date-label mono" id="dashboard-date-label">${escHtml(data.today)}</span>
          <span class="dashboard-weekday-marker" id="dashboard-weekday-marker"></span>
        </div>
        <div class="dashboard-kpi-row">
          <span class="dashboard-kpi-chip" id="dashboard-kpi-open">
            <span class="dashboard-kpi-label">Open</span>
            <span class="dashboard-kpi-value">${data.summary.totalOpen}</span>
          </span>
          <span class="dashboard-kpi-chip" id="dashboard-kpi-today">
            <span class="dashboard-kpi-label">Today</span>
            <span class="dashboard-kpi-value">${data.summary.attentionCount}</span>
            <span class="dashboard-kpi-note">${data.summary.overdueCount}</span>
          </span>
          <span class="dashboard-kpi-chip" id="dashboard-kpi-done">
            <span class="dashboard-kpi-label">Done %</span>
            <span class="dashboard-kpi-value">${data.summary.completionRate}%</span>
          </span>
        </div>
        <button class="btn" id="btn-refresh" type="button">Refresh</button>
      </div>
    </header>

    <section class="dashboard-toolbar" id="dashboard-toolbar">
      <label class="search-shell" aria-label="Search tasks">
        <span>Search</span>
        <input id="task-search" type="search" placeholder="text, tag, file path, date" />
      </label>
      <div class="filter-row" id="filter-row"></div>
    </section>

    <section class="dashboard-action-bar" id="dashboard-action-bar">
      <section class="action-panel action-panel-quick-add">
        <div class="card-header">
          <div>
            <div class="eyebrow">Quick Add</div>
            <h3>Add a task</h3>
            <p>保存先と due を指定して、そのまま上部から追加します。</p>
          </div>
        </div>
        <div class="composer-body">
          <div class="field">
            <span>Task</span>
            <textarea id="new-task-text" placeholder="例: 見積もりを送る #work"></textarea>
          </div>
          <div class="field-grid" style="margin-bottom: 12px;">
            <label class="field-compact">
              <span>Save In Date File</span>
              <input id="new-task-target-date" type="date" />
            </label>
            <label class="field-compact">
              <span>Due Date</span>
              <input id="new-task-due-date" type="date" />
            </label>
          </div>
          <p class="helper" id="composer-target-preview">保存先: tasks/inbox.md</p>
          <div class="inline-actions">
            <button class="btn btn-primary" id="btn-create-task" type="button">Add Task</button>
            <button class="btn" id="btn-clear-task" type="button">Clear</button>
          </div>
        </div>
      </section>

      <section class="action-panel action-panel-ai-extract">
        <div class="card-header">
          <div>
            <div class="eyebrow">AI Extract</div>
            <h3>Capture candidates</h3>
            <p>Moments と Notes の抽出操作は上部に残し、リストより軽い補助面として扱います。</p>
          </div>
        </div>
${buildDashboardExtractSectionHtml(data.today)}
      </section>
    </section>

    <section class="candidate-block" id="candidate-block" style="display:none;">
      <div class="card-header">
        <div>
          <div class="eyebrow">Candidates</div>
          <h2>Extracted tasks</h2>
          <p>AI が抽出したタスク候補です。追加するか非表示にします。</p>
        </div>
      </div>
      <div class="candidate-items" id="candidate-items"></div>
    </section>

    <section class="list-surface">
      <div class="card-header">
        <div>
          <div class="eyebrow">Main List</div>
          <h2>All task sections</h2>
          <p>メインリストを最優先に見せる listboard shell です。</p>
        </div>
      </div>
      <div class="dashboard-main-list" id="dashboard-main-list"></div>
    </section>

    <section class="analytics-strip" id="analytics-strip">
      <section class="analytics-panel">
        <div class="card-header">
          <div>
            <div class="eyebrow">Upcoming Load</div>
            <h3>Next 7 days</h3>
          </div>
        </div>
        <div class="week-chart week-chart-compact">${weekBarsHtml}</div>
        <div class="chart-legend">
          <span><span class="legend-dot" style="background:color-mix(in srgb, var(--success) 60%, transparent)"></span>Done</span>
          <span><span class="legend-dot" style="background:color-mix(in srgb, var(--accent) 55%, transparent)"></span>Open</span>
        </div>
      </section>

      <section class="analytics-panel">
        <div class="card-header">
          <div>
            <div class="eyebrow">Open Mix</div>
            <h3>Category balance</h3>
          </div>
        </div>
        <div class="category-list category-list-compact">${categoryHtml}</div>
      </section>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const dashboardData = ${payload};
    const savedState = vscode.getState() || {};
    const pendingCandidateAdds = [];

    function sanitizeBrowserTaskText(text) {
      return String(text || "")
        .replaceAll(String.fromCharCode(13) + String.fromCharCode(10), String.fromCharCode(10))
        .split(String.fromCharCode(10))
        .map(function (line) {
          return line.trim();
        })
        .filter(Boolean)
        .join(" / ")
        .split(/\s+/)
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    function normalizedCandidateIdentity(text) {
      return sanitizeBrowserTaskText(text)
        .split(" ")
        .filter(function (part) {
          if (!(part.startsWith("📅") || part.startsWith("due:") || part.startsWith("@"))) {
            return true;
          }

          const datePart = part.startsWith("due:") ? part.slice(4) : part.slice(1);
          return !(datePart.length === 10 && datePart[4] === "-" && datePart[7] === "-");
        })
        .join(" ")
        .trim()
        .normalize("NFKC")
        .toLowerCase();
    }

    function normalizeStoredCandidateTask(task) {
      if (!task || typeof task !== "object") {
        return null;
      }

      const text = sanitizeBrowserTaskText(typeof task.text === "string" ? task.text : "");
      if (!text) {
        return null;
      }

      return {
        kind: "candidate",
        text: text,
        dueDate:
          typeof task.dueDate === "string" && task.dueDate.length === 10 && task.dueDate[4] === "-" && task.dueDate[7] === "-"
            ? task.dueDate
            : null,
        category: typeof task.category === "string" && task.category.trim().length > 0 ? task.category : "other",
        priority: typeof task.priority === "string" && task.priority.trim().length > 0 ? task.priority : "medium",
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
      };
    }

    function normalizeStoredCandidateTaskForSource(task, fallbackSource) {
      if (!task || typeof task !== "object") {
        return null;
      }

      const normalizedTask = normalizeStoredCandidateTask(task);
      if (!normalizedTask) {
        return null;
      }

      const legacySourceLabel =
        typeof task.sourceLabel === "string" && task.sourceLabel.trim().length > 0
          ? task.sourceLabel
          : typeof task.sourceNote === "string" && task.sourceNote.trim().length > 0
            ? task.sourceNote
            : fallbackSource === "notes"
              ? "Notes"
              : "Moments";

      return {
        ...normalizedTask,
        source: fallbackSource,
        sourceLabel: legacySourceLabel,
      };
    }

    function migrateLegacyCandidateState(savedState) {
      if (Array.isArray(savedState.candidateTasks)) {
        const candidateTasks = savedState.candidateTasks
          .map(function (task) {
            const normalizedTask = normalizeStoredCandidateTask(task);
            if (!normalizedTask) {
              return null;
            }

            return {
              ...normalizedTask,
              order: typeof task.order === "number" ? task.order : undefined,
              added: Boolean(task.added),
              extractRunAt: typeof task.extractRunAt === "string" ? task.extractRunAt : undefined,
              extractionIndex:
                typeof task.extractionIndex === "number"
                  ? task.extractionIndex
                  : typeof task.order === "number"
                    ? task.order
                    : 0,
            };
          })
          .filter(Boolean);
        const maxOrder = candidateTasks.reduce(function (highest, task) {
          return typeof task.order === "number" && task.order > highest ? task.order : highest;
        }, -1);
        return {
          candidateTasks: candidateTasks,
          candidateOrderSeed:
            typeof savedState.candidateOrderSeed === "number"
              ? savedState.candidateOrderSeed
              : maxOrder + 1,
          addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
            ? savedState.addedCandidateKeys.filter(function (key) {
                return typeof key === "string" && key.length > 0;
              })
            : [],
        };
      }

      let nextOrder = 0;
      const fromMoments = (Array.isArray(savedState.extractedTasks) ? savedState.extractedTasks : []).map(
        function (task) {
          const normalizedTask = normalizeStoredCandidateTaskForSource(task, "moments");
          if (!normalizedTask) {
            return null;
          }

          return {
            ...normalizedTask,
            order: nextOrder++,
            added: Array.isArray(savedState.addedExtractedKeys)
              ? savedState.addedExtractedKeys.includes(normalizedCandidateIdentity(normalizedTask.text))
              : false,
            extractionIndex: nextOrder - 1,
          };
        },
      ).filter(Boolean);
      const fromNotes = (Array.isArray(savedState.notesExtractedTasks) ? savedState.notesExtractedTasks : []).map(
        function (task) {
          const normalizedTask = normalizeStoredCandidateTaskForSource(task, "notes");
          if (!normalizedTask) {
            return null;
          }

          return {
            ...normalizedTask,
            order: nextOrder++,
            added: Array.isArray(savedState.notesAddedExtractedKeys)
              ? savedState.notesAddedExtractedKeys.includes(normalizedCandidateIdentity(normalizedTask.text))
              : false,
            extractionIndex: nextOrder - 1,
          };
        },
      ).filter(Boolean);

      return {
        candidateTasks: fromMoments.concat(fromNotes),
        candidateOrderSeed: nextOrder,
        addedCandidateKeys: (Array.isArray(savedState.addedExtractedKeys) ? savedState.addedExtractedKeys : []).concat(
          Array.isArray(savedState.notesAddedExtractedKeys) ? savedState.notesAddedExtractedKeys : [],
        ),
      };
    }

    const migratedCandidates = migrateLegacyCandidateState(savedState);

    const state = {
      filter: savedState.filter === "focus" ? "attention" : (savedState.filter || "all"),
      search: savedState.search || "",
      targetDate: savedState.targetDate || "",
      composerText: savedState.composerText || "",
      composerDueDate: savedState.composerDueDate || "",
      aiSourceDate: savedState.aiSourceDate || dashboardData.today,
      editingId: savedState.editingId || null,
      candidateTasks: migratedCandidates.candidateTasks,
      candidateOrderSeed: migratedCandidates.candidateOrderSeed,
      addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
        ? savedState.addedCandidateKeys
        : migratedCandidates.addedCandidateKeys,
      aiStatus: savedState.aiStatus || "",
      aiStatusType: savedState.aiStatusType || "idle",
      notesFromDate: savedState.notesFromDate || dashboardData.today,
      notesToDate: savedState.notesToDate || dashboardData.today,
      notesAiStatus: savedState.notesAiStatus || "",
      notesAiStatusType: savedState.notesAiStatusType || "idle",
      candidateBlockShown: savedState.candidateBlockShown || false,
      candidateBlockError: savedState.candidateBlockError || "",
    };

    const simplifiedSectionOrder = ["today", "planned", "unsorted", "done"];
    const simplifiedSectionTitles = {
      today: "Today",
      planned: "Planned",
      unsorted: "Unsorted",
      done: "Done",
    };
    const simplifiedSectionDescriptions = {
      today: "今日と期限超過",
      planned: "7日以内と先の予定",
      unsorted: "inbox や日付なしの棚卸し待ち",
      done: "完了済み",
    };

    const filterDefinitions = [
      { id: "all", label: "All", count: dashboardData.tasks.length },
      { id: "today", label: "Today", count: dashboardData.sectionCounts.overdue + dashboardData.sectionCounts.today },
      { id: "planned", label: "Planned", count: dashboardData.sectionCounts.upcoming + dashboardData.sectionCounts.scheduled },
      { id: "done", label: "Done", count: dashboardData.sectionCounts.done },
    ];

    const taskSearchInput = document.getElementById("task-search");
    const filterRow = document.getElementById("filter-row");
    const taskList = document.getElementById("dashboard-main-list");
    const newTaskText = document.getElementById("new-task-text");
    const newTaskTargetDate = document.getElementById("new-task-target-date");
    const newTaskDueDate = document.getElementById("new-task-due-date");
    const composerTargetPreview = document.getElementById("composer-target-preview");
    const aiSourceDateInput = document.getElementById("ai-source-date");
    const aiStatus = document.getElementById("ai-status");
    const notesFromDateInput = document.getElementById("notes-from-date");
    const notesToDateInput = document.getElementById("notes-to-date");
    const notesStatus = document.getElementById("notes-extract-status");
    const dashboardDateLabel = document.getElementById("dashboard-date-label");
    const dashboardWeekdayMarker = document.getElementById("dashboard-weekday-marker");

    if (!taskSearchInput || !filterRow || !taskList || !newTaskText || !newTaskTargetDate || !newTaskDueDate || !composerTargetPreview || !aiSourceDateInput || !aiStatus || !notesFromDateInput || !notesToDateInput || !notesStatus || !dashboardDateLabel || !dashboardWeekdayMarker) {
      throw new Error("Task Dashboard failed to initialize required webview controls.");
    }

    function persistState() {
      vscode.setState({
        filter: state.filter,
        search: state.search,
        targetDate: state.targetDate,
        composerText: state.composerText,
        composerDueDate: state.composerDueDate,
        aiSourceDate: state.aiSourceDate,
        editingId: state.editingId,
        candidateTasks: state.candidateTasks,
        candidateOrderSeed: state.candidateOrderSeed,
        addedCandidateKeys: state.addedCandidateKeys,
        aiStatus: state.aiStatus,
        aiStatusType: state.aiStatusType,
        notesFromDate: state.notesFromDate,
        notesToDate: state.notesToDate,
        notesAiStatus: state.notesAiStatus,
        notesAiStatusType: state.notesAiStatusType,
        candidateBlockShown: state.candidateBlockShown,
        candidateBlockError: state.candidateBlockError,
      });
    }

    function esc(value) {
      return String(value)
        .replace(new RegExp("&", "g"), "&amp;")
        .replace(new RegExp("<", "g"), "&lt;")
        .replace(new RegExp(">", "g"), "&gt;")
        .replace(new RegExp('"', "g"), "&quot;");
    }

    function formatDateLabel(date) {
      if (!date) {
        return "No date";
      }

      const parts = date.split("-");
      if (parts.length !== 3) {
        return date;
      }

      return Number.parseInt(parts[1], 10) + "/" + Number.parseInt(parts[2], 10);
    }

    function formatDashboardHeaderDate(dateString) {
      const date = new Date(String(dateString || dashboardData.today) + "T00:00:00");
      if (Number.isNaN(date.getTime())) {
        return String(dateString || dashboardData.today);
      }

      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }

    function formatDashboardWeekdayMarker(dateString) {
      const date = new Date(String(dateString || dashboardData.today) + "T00:00:00");
      if (Number.isNaN(date.getTime())) {
        return "";
      }

      return date.toLocaleDateString(undefined, { weekday: "short" });
    }

    function getCurrentDashboardDate() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      return year + "-" + month + "-" + day;
    }

    function syncHeaderDate() {
      const currentDate = getCurrentDashboardDate();
      dashboardDateLabel.textContent = formatDashboardHeaderDate(currentDate);
      dashboardWeekdayMarker.textContent = formatDashboardWeekdayMarker(currentDate);
    }

    function extractedTaskKey(task) {
      return normalizeTaskIdentity(task.text);
    }

    function canAddDashboardCandidate(task, existingTaskKeys) {
      if (existingTaskKeys && existingTaskKeys.has(extractedTaskKey(task))) {
        return false;
      }

      return !task.existsAlready;
    }

    function normalizeTaskIdentity(text) {
      return normalizedCandidateIdentity(text);
    }

    function createPendingCandidateRequestId(task) {
      return "candidate-" + String(task.order) + "-" + Date.now();
    }

    function removePendingCandidateAdd(requestId) {
      const index = pendingCandidateAdds.findIndex(function (pending) {
        return pending.requestId === requestId;
      });
      if (index < 0) {
        return null;
      }

      const pending = pendingCandidateAdds[index];
      pendingCandidateAdds.splice(index, 1);
      return pending;
    }

    function getSaveTargetLabel() {
      return state.targetDate ? "tasks/" + state.targetDate + ".md" : "tasks/inbox.md";
    }

    function updateComposerPreview() {
      composerTargetPreview.textContent = "保存先: " + getSaveTargetLabel();
    }

    function getExistingTaskKeys() {
      const persistedTaskKeys = (dashboardData.tasks || [])
        .map(function (task) {
          return normalizeTaskIdentity(task.text);
        })
        .filter(Boolean);
      state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {
        return !persistedTaskKeys.includes(key);
      });
      const locallyAddedKeys = (state.addedCandidateKeys || []).filter(Boolean);
      return new Set(
        persistedTaskKeys
          .concat(locallyAddedKeys)
          .filter(Boolean),
      );
    }

    function matchesDashboardListItemFilter(item, filter) {
      if (filter === "all") {
        return true;
      }

      if (item.kind === "candidate") {
        return false;
      }

      if (filter === "today") {
        return item.section === "overdue" || item.section === "today";
      }

      if (filter === "planned") {
        return item.section === "upcoming" || item.section === "scheduled";
      }

      if (filter === "done") {
        return item.section === "done";
      }

      return item.section === filter;
    }

    function matchesDashboardListItemSearch(item, query) {
      const normalizedQuery = String(query || "").trim().toLowerCase();
      if (!normalizedQuery) {
        return true;
      }

      const haystack = item.kind === "candidate"
        ? [
            item.text,
            item.sourceLabel || "",
            item.source || "",
            item.category || "",
            item.priority || "",
            item.dueDate || "",
            item.existsAlready ? "already exists" : "",
            "candidate",
          ]
        : [item.text, item.relativePath || "", item.date || "", item.dueDate || ""].concat(item.tags || []);

      return haystack.join(" ").toLowerCase().includes(normalizedQuery);
    }

    function buildDashboardListViewModel(items, filter, search) {
      function buildDashboardEmptyMessage(filter) {
        switch (filter) {
          case "all":
            return "No tasks yet||Use Quick Add or AI Extract to create your first task.";
          default:
            return "No items in this filter";
        }
      }

      const normalizedSearch = String(search || "").trim();
      const filteredItems = items.filter(function (item) {
        return matchesDashboardListItemFilter(item, filter);
      });
      const visibleItems = filteredItems.filter(function (item) {
        return matchesDashboardListItemSearch(item, search);
      });
      if (filter === "all") {
        if (normalizedSearch && visibleItems.length === 0) {
          return { sections: [], emptyMessage: "No search results" };
        }

        if (!normalizedSearch && filteredItems.length === 0) {
          return { sections: [], emptyMessage: buildDashboardEmptyMessage("all") };
        }

        const sections = [];

        simplifiedSectionOrder.forEach(function (simplifiedSection) {
          let internalSections;
          if (simplifiedSection === "today") {
            internalSections = ["overdue", "today"];
          } else if (simplifiedSection === "planned") {
            internalSections = ["upcoming", "scheduled"];
          } else if (simplifiedSection === "unsorted") {
            internalSections = ["backlog"];
          } else {
            internalSections = ["done"];
          }

          const taskItems = visibleItems.filter(function (item) {
            return item.kind === "task" && internalSections.includes(item.section);
          });
          if (!normalizedSearch || taskItems.length > 0) {
            sections.push({
              key: simplifiedSection,
              title: simplifiedSectionTitles[simplifiedSection],
              items: taskItems,
            });
          }
        });

        return { sections: sections, emptyMessage: null };
      }

      if (filteredItems.length === 0) {
        return {
          sections: [],
          emptyMessage: buildDashboardEmptyMessage(filter),
        };
      }

      if (visibleItems.length === 0) {
        return {
          sections: [],
          emptyMessage: normalizedSearch ? "No search results" : buildDashboardEmptyMessage(filter),
        };
      }

      const title = simplifiedSectionTitles[filter] || (filter.charAt(0).toUpperCase() + filter.slice(1));

      return {
        sections: [],
        flatItems: visibleItems,
        emptyMessage: null,
      };
    }

    function getVisibleCandidates() {
      const existingTaskKeys = getExistingTaskKeys();
      return (state.candidateTasks || [])
        .map(function (task) {
          return {
            ...task,
            existsAlready: existingTaskKeys.has(extractedTaskKey(task)) || Boolean(task.existsAlready),
          };
        })
        .filter(function (task) {
          return !task.added;
        })
        .sort(function (a, b) {
          const aRunAt = a.extractRunAt || "";
          const bRunAt = b.extractRunAt || "";
          if (aRunAt !== bRunAt) {
            return bRunAt.localeCompare(aRunAt);
          }
          return (a.order || 0) - (b.order || 0);
        });
    }

    function mergeCandidateBatch(source, tasks) {
      const retained = (state.candidateTasks || []).filter(function (task) {
        return task.source !== source;
      });
      const extractRunAt = new Date().toISOString();
      const merged = (tasks || []).map(function (task) {
        return {
          kind: "candidate",
          source: source,
          sourceLabel: task.sourceLabel || (source === "notes" ? "Notes" : "Moments"),
          existsAlready: Boolean(task.existsAlready),
          order: state.candidateOrderSeed++,
          added: false,
          ...task,
          extractRunAt: extractRunAt,
        };
      });
      state.candidateTasks = retained.concat(merged);
    }

    function getListViewModel() {
      const listItems = (dashboardData.tasks || []).filter(function (item) {
        return item.kind === "task";
      });
      return buildDashboardListViewModel(listItems, state.filter, state.search);
    }

    function renderFilters() {
      filterDefinitions[0].count = dashboardData.tasks.length + getVisibleCandidates().length;
      filterDefinitions[1].count = dashboardData.sectionCounts.overdue + dashboardData.sectionCounts.today;
      filterDefinitions[2].count = dashboardData.sectionCounts.upcoming + dashboardData.sectionCounts.scheduled;
      filterDefinitions[3].count = dashboardData.sectionCounts.done;
      filterRow.innerHTML = filterDefinitions
        .map(function (filter) {
          const activeClass = filter.id === state.filter ? " is-active" : "";
          return '<button type="button" class="filter-chip' + activeClass + '" data-filter="' + esc(filter.id) + '">' +
            '<span>' + esc(filter.label) + '</span>' +
            '<strong>' + filter.count + '</strong>' +
          "</button>";
        })
        .join("");
    }

    function renderTaskMeta(task) {
      const badges = [];
      if (task.date) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-date">' + esc(formatDateLabel(task.date)) + "</span>");
      }
      if (task.dueDate) {
        const dueClass = task.section === "overdue" ? " is-danger" : task.section === "today" ? " is-warning" : " is-accent";
        badges.push('<span class="badge task-row-meta-item task-row-meta-due' + dueClass + '">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>");
      }
      for (const tag of task.tags || []) {
        badges.push('<span class="badge is-accent task-row-meta-item task-row-meta-tag">' + esc(tag) + "</span>");
      }
      badges.push('<span class="badge task-row-meta-item task-row-meta-source task-row-meta-source-saved">' + esc(task.relativePath) + "</span>");
      return '<div class="task-row-meta task-row-meta-saved">' + badges.join("") + "</div>";
    }

    function renderCandidateMeta(task) {
      const badges = [];
      if (task.dueDate) {
        badges.push('<span class="badge is-accent task-row-meta-item task-row-meta-candidate-due">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>");
      }
      if (task.category) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-category">' + esc(task.category) + "</span>");
      }
      if (task.priority) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-priority">' + esc(task.priority) + "</span>");
      }
      badges.push('<span class="badge task-row-meta-item task-row-meta-source task-row-meta-source-candidate">' + esc(task.sourceLabel || "Unknown") + "</span>");
      return '<div class="task-row-meta task-row-meta-candidate">' + badges.join("") + "</div>";
    }

    function renderTaskItem(task) {
      const itemClasses = [
        "task-row",
        "task-row-saved",
        task.done ? "is-done" : "",
        task.section === "overdue" ? "is-overdue" : "",
        task.section === "today" ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (state.editingId === task.id) {
        return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '" tabindex="-1">' +
          '<label class="task-row-toggle-entry"><input class="task-row-toggle" type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
          '<div class="task-row-body">' +
            '<div class="task-edit">' +
              '<label class="field">' +
                "<span>Task</span>" +
                '<textarea data-role="edit-text">' + esc(task.text) + "</textarea>" +
              "</label>" +
              '<div class="field-grid">' +
                '<label class="field-compact">' +
                  "<span>Due</span>" +
                  '<input type="date" data-role="edit-due" value="' + esc(task.dueDate || "") + '">' +
                "</label>" +
                '<div class="field-compact">' +
                  "<span>Source</span>" +
                  '<input type="text" value="' + esc(task.relativePath) + '" disabled>' +
                "</div>" +
              "</div>" +
              '<div class="inline-actions">' +
                '<button type="button" class="btn btn-primary" data-action="save-edit" data-task-id="' + esc(task.id) + '">Save</button>' +
                '<button type="button" class="btn" data-action="cancel-edit">Cancel</button>' +
                '<button type="button" class="btn" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">Open File</button>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</article>";
      }

      return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '" tabindex="-1">' +
        '<label class="task-row-toggle-entry"><input class="task-row-toggle" type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
        '<div class="task-row-body">' +
          '<div class="task-row-main">' +
            '<div class="task-row-title-entry"><button type="button" class="task-row-title" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">' + esc(task.text) + "</button></div>" +
            '<div class="task-row-secondary-actions">' +
              '<button type="button" class="text-btn" data-action="edit" data-task-id="' + esc(task.id) + '">Edit</button>' +
              '<button type="button" class="text-btn" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">Open</button>' +
              '<button type="button" class="text-btn is-danger" data-action="delete" data-task-id="' + esc(task.id) + '">Delete</button>' +
            "</div>" +
          "</div>" +
          renderTaskMeta(task) +
        "</div>" +
      "</article>";
    }

    function renderCandidateItem(task, index) {
      const canAdd = canAddDashboardCandidate(task, getExistingTaskKeys());
      const itemClasses = ["task-row", "task-row-candidate", task.existsAlready ? "is-candidate-blocked" : ""]
        .filter(Boolean)
        .join(" ");
      return '<article class="' + itemClasses + '">' +
        '<div class="task-row-leading"><span class="badge task-row-label">AI</span></div>' +
        '<div class="task-row-body">' +
          '<div class="task-row-main">' +
            '<div class="task-row-title-entry"><div class="task-row-title">' + esc(task.text) + '</div></div>' +
            '<div class="task-row-candidate-actions">' +
              '<span class="badge task-row-label">Candidate</span>' +
              '<button type="button" class="text-btn" data-action="dismiss-candidate" data-index="' + index + '">Dismiss</button>' +
              '<button type="button" class="text-btn' + (canAdd ? '' : ' is-danger') + '"' + (canAdd ? '' : ' disabled') + ' data-action="add-candidate" data-index="' + index + '">Add</button>' +
              (canAdd ? '' : '<span class="badge is-danger">Already exists</span>') +
            '</div>' +
          '</div>' +
          renderCandidateMeta(task) +
        '</div>' +
      '</article>';
    }

    function renderCandidateBlock() {
      const candidateBlock = document.getElementById("candidate-block");
      const candidateItems = document.getElementById("candidate-items");
      if (!candidateBlock || !candidateItems) {
        return;
      }

      const visibleCandidates = getVisibleCandidates();
      const hasCandidates = visibleCandidates.length > 0;
      const shouldShow = state.candidateBlockShown || hasCandidates;

      if (!shouldShow) {
        candidateBlock.style.display = "none";
        return;
      }

      candidateBlock.style.display = "";
      if (!state.candidateBlockShown) {
        state.candidateBlockShown = true;
      }

      let html = "";
      if (state.candidateBlockError) {
        html += '<div class="candidate-block-error">' +
          '<span class="candidate-block-error-text">' + esc(state.candidateBlockError) + '</span>' +
          '<button type="button" class="candidate-block-error-dismiss" data-action="dismiss-candidate-error" aria-label="Dismiss error">&times;</button>' +
          '</div>';
      }

      if (!hasCandidates) {
        html += '<div class="empty-state">' +
          '<strong class="empty-state-title">No candidates</strong>' +
          '<p class="empty-state-body">Run AI Extract to find task candidates.</p>' +
        '</div>';
        candidateItems.innerHTML = html;
        return;
      }

      html += visibleCandidates
        .map(function (task, index) {
          return renderCandidateItem(task, index);
        })
        .join("");

      candidateItems.innerHTML = html;
    }

    var candidateBlockEl = document.getElementById("candidate-block");
    if (candidateBlockEl) {
      candidateBlockEl.addEventListener("click", function (event) {
        var actionEl = event.target.closest("[data-action]");
        if (!actionEl) {
          return;
        }
        if (actionEl.dataset.action === "dismiss-candidate-error") {
          state.candidateBlockError = "";
          persistState();
          rerender();
        }
      });
    }

    function renderEmptyState(message) {
      const parts = String(message || "").split("||");
      const title = parts[0] || "";
      const body = parts[1] || "";
      return '<div class="empty-state">' +
        '<strong class="empty-state-title">' + esc(title) + '</strong>' +
        (body ? '<p class="empty-state-body">' + esc(body) + '</p>' : '') +
      '</div>';
    }

    function renderTasks() {
      const viewModel = getListViewModel();
      if (viewModel.emptyMessage) {
        taskList.innerHTML = renderEmptyState(viewModel.emptyMessage);
        return;
      }

      const visibleCandidates = getVisibleCandidates();
      if (viewModel.flatItems && viewModel.flatItems.length > 0) {
        taskList.innerHTML = viewModel.flatItems
          .map(function (item) {
            if (item.kind === "candidate") {
              const index = visibleCandidates.findIndex(function (candidate) {
                return candidate.order === item.order;
              });
              return renderCandidateItem(item, index);
            }
            return renderTaskItem(item);
          })
          .join("");
        return;
      }

      const html = viewModel.sections
        .map(function (section) {
          const subtitle = state.filter === "all"
            ? simplifiedSectionDescriptions[section.key]
            : "filtered items";
          const items = section.items
            .map(function (item) {
              if (item.kind === "candidate") {
                const index = visibleCandidates.findIndex(function (candidate) {
                  return candidate.order === item.order;
                });
                return renderCandidateItem(item, index);
              }
              return renderTaskItem(item);
            })
            .join("");
          return '<section class="task-section">' +
            '<div class="task-section-header">' +
              "<h3>" + esc(section.title) + "</h3>" +
              "<span>" + section.items.length + " · " + esc(subtitle) + "</span>" +
            "</div>" +
            '<div class="task-items">' + items + "</div>" +
          "</section>";
        })
        .join("");

      taskList.innerHTML = html;
    }

    function setAiStatus(type, message) {
      state.aiStatusType = type;
      state.aiStatus = message || "";
      persistState();

      aiStatus.className = "status-line" + (type === "error" ? " is-error" : "");
      aiStatus.textContent = state.aiStatus;
    }

    function setNotesAiStatus(type, message) {
      state.notesAiStatusType = type;
      state.notesAiStatus = message || "";
      persistState();

      notesStatus.className = "status-line" + (type === "error" ? " is-error" : "");
      notesStatus.textContent = state.notesAiStatus;
    }

    function syncStaticInputs() {
      taskSearchInput.value = state.search;
      newTaskText.value = state.composerText;
      newTaskTargetDate.value = state.targetDate;
      newTaskDueDate.value = state.composerDueDate;
      aiSourceDateInput.value = state.aiSourceDate;
      notesFromDateInput.value = state.notesFromDate;
      notesToDateInput.value = state.notesToDate;
      updateComposerPreview();
      setAiStatus(state.aiStatusType, state.aiStatus);
      setNotesAiStatus(state.notesAiStatusType, state.notesAiStatus);
    }

    function rerender() {
      persistState();
      renderFilters();
      renderTasks();
      renderCandidateBlock();
      updateComposerPreview();
      syncHeaderDate();
    }

    document.getElementById("btn-refresh").addEventListener("click", function () {
      vscode.postMessage({ command: "refresh" });
    });

    document.getElementById("btn-clear-task").addEventListener("click", function () {
      state.composerText = "";
      state.composerDueDate = "";
      newTaskText.value = "";
      newTaskDueDate.value = "";
      rerender();
    });

    document.getElementById("btn-create-task").addEventListener("click", function () {
      const text = newTaskText.value.trim();
      if (!text) {
        setAiStatus("error", "Task text is required.");
        return;
      }

      newTaskText.value = "";
      state.composerText = "";
      state.aiStatus = "";
      state.aiStatusType = "idle";
      if (state.filter !== "all") {
        const hasDate = state.targetDate || state.composerDueDate;
        state.filter = hasDate ? "all" : "unsorted";
      }
      persistState();
      vscode.postMessage({
        command: "createTask",
        text,
        targetDate: state.targetDate || null,
        dueDate: state.composerDueDate || null,
      });
    });

    document.getElementById("btn-ai-extract").addEventListener("click", function () {
      mergeCandidateBatch("moments", []);
      setAiStatus("processing", state.aiSourceDate + " の Moments を分析しています...");
      rerender();
      vscode.postMessage({ command: "aiExtract", sourceDate: state.aiSourceDate });
    });

    document.getElementById("btn-extract-notes").addEventListener("click", function () {
      mergeCandidateBatch("notes", []);
      setNotesAiStatus("processing", state.notesFromDate + " ～ " + state.notesToDate + " のノートを分析しています...");
      rerender();
      vscode.postMessage({
        command: "extractFromNotes",
        fromDate: state.notesFromDate,
        toDate: state.notesToDate,
      });
    });

    document.getElementById("notes-from-date").addEventListener("input", function (event) {
      state.notesFromDate = event.target.value || dashboardData.today;
      persistState();
    });

    document.getElementById("notes-to-date").addEventListener("input", function (event) {
      state.notesToDate = event.target.value || dashboardData.today;
      persistState();
    });

    taskSearchInput.addEventListener("input", function (event) {
      state.search = event.target.value;
      rerender();
    });

    newTaskText.addEventListener("input", function (event) {
      state.composerText = event.target.value;
      persistState();
    });

    newTaskTargetDate.addEventListener("input", function (event) {
      state.targetDate = event.target.value;
      rerender();
    });

    newTaskDueDate.addEventListener("input", function (event) {
      state.composerDueDate = event.target.value;
      persistState();
    });

    aiSourceDateInput.addEventListener("input", function (event) {
      state.aiSourceDate = event.target.value || dashboardData.today;
      persistState();
    });

    function handleAddExtractedAction(actionEl) {
      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);
      const visibleCandidates = getVisibleCandidates();
      if (Number.isNaN(index) || !visibleCandidates[index]) {
        return;
      }

      const task = visibleCandidates[index];
      if (!canAddDashboardCandidate(task, getExistingTaskKeys())) {
        rerender();
        return;
      }

      const requestId = createPendingCandidateRequestId(task);
      pendingCandidateAdds.push({
        requestId: requestId,
        order: task.order,
        key: extractedTaskKey(task),
        source: task.source,
      });

      state.candidateTasks = (state.candidateTasks || []).map(function (candidate) {
        return candidate.order === task.order ? { ...candidate, added: true } : candidate;
      });
      if (!state.addedCandidateKeys.includes(extractedTaskKey(task))) {
        state.addedCandidateKeys = state.addedCandidateKeys.concat([extractedTaskKey(task)]);
      }
      persistState();

      vscode.postMessage({
        command: "addExtractedTask",
        requestId: requestId,
        text: task.text,
        dueDate: task.dueDate || null,
        targetDate: state.targetDate || null,
      });
      rerender();
    }

    function handleDismissExtractedAction(actionEl) {
      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);
      const visibleCandidates = getVisibleCandidates();
      if (Number.isNaN(index) || !visibleCandidates[index]) {
        return;
      }

      const task = visibleCandidates[index];
      state.candidateTasks = (state.candidateTasks || []).filter(function (candidate) {
        return candidate.order !== task.order;
      });
      state.candidateBlockError = "";
      persistState();
      vscode.postMessage({
        command: "dismissExtractedTask",
        text: task.text,
      });
      rerender();
    }

    filterRow.addEventListener("click", function (event) {
      const button = event.target.closest("[data-filter]");
      if (!button) {
        return;
      }

      state.filter = button.dataset.filter;
      rerender();
    });

    taskList.addEventListener("click", function (event) {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) {
        return;
      }

      const action = actionEl.dataset.action;
      if (action === "edit") {
        state.editingId = actionEl.dataset.taskId || null;
        rerender();
        return;
      }

      if (action === "cancel-edit") {
        state.editingId = null;
        rerender();
        return;
      }

      if (action === "save-edit") {
        const taskEl = actionEl.closest("[data-task-id]");
        if (!taskEl) {
          return;
        }

        const textInput = taskEl.querySelector("[data-role='edit-text']");
        const dueInput = taskEl.querySelector("[data-role='edit-due']");
        const nextText = textInput ? textInput.value : "";
        const nextDue = dueInput ? dueInput.value : "";
        state.editingId = null;
        persistState();
        vscode.postMessage({
          command: "updateTask",
          taskId: actionEl.dataset.taskId,
          text: nextText,
          dueDate: nextDue || null,
        });
        return;
      }

      if (action === "delete") {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) {
          return;
        }

        if (!window.confirm("このタスクを削除しますか?")) {
          return;
        }

        vscode.postMessage({ command: "deleteTask", taskId });
        return;
      }

      if (action === "open") {
        vscode.postMessage({
          command: "openFile",
          filePath: actionEl.dataset.file || "",
          lineIndex: Number.parseInt(actionEl.dataset.line || "0", 10),
        });
        return;
      }

      if (action === "add-extracted" || action === "add-candidate") {
        handleAddExtractedAction(actionEl);
        return;
      }

      if (action === "dismiss-extracted" || action === "dismiss-candidate") {
        handleDismissExtractedAction(actionEl);
        return;
      }
    });

    taskList.addEventListener("change", function (event) {
      const checkbox = event.target.closest("[data-action='toggle']");
      if (!checkbox) {
        return;
      }

      vscode.postMessage({
        command: "toggleTask",
        taskId: checkbox.dataset.taskId,
        done: checkbox.checked,
      });
    });

    window.addEventListener("message", function (event) {
      const message = event.data;
      if (message.type === "aiStatus") {
        setAiStatus(message.status, message.message || "");
        rerender();
        return;
      }

      if (message.type === "extractResult") {
        state.filter = "all";
        state.candidateBlockShown = true;
        state.candidateBlockError = "";
        mergeCandidateBatch("moments", message.tasks || []);
        persistState();
        rerender();
        return;
      }

      if (message.type === "candidateAddResult") {
        state.candidateBlockError = "";
        removePendingCandidateAdd(message.requestId || null);
        rerender();
        return;
      }

      if (message.type === "candidateAddFailed") {
        const pending = removePendingCandidateAdd(message.requestId || null);
        if (pending) {
          state.candidateTasks = (state.candidateTasks || []).map(function (candidate) {
            return candidate.order === pending.order ? { ...candidate, added: false } : candidate;
          });
          state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {
            return key !== pending.key;
          });
        }
        state.candidateBlockError = message.message || "Failed to add candidate task.";
        if (pending && pending.source === "notes") {
          setNotesAiStatus("error", message.message || "Failed to add candidate task.");
        } else {
          setAiStatus("error", message.message || "Failed to add candidate task.");
        }
        rerender();
        return;
      }

      if (message.type === "notesAiStatus") {
        setNotesAiStatus(message.status, message.message || "");
        rerender();
        return;
      }

      if (message.type === "notesExtractResult") {
        state.filter = "all";
        state.candidateBlockShown = true;
        state.candidateBlockError = "";
        mergeCandidateBatch("notes", message.tasks || []);
        persistState();
        rerender();
      }
    });

    syncStaticInputs();
    syncHeaderDate();
    rerender();
  </script>
</body>
</html>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toScriptData(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
