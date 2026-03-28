import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { extractTasksFromMoments, type ExtractedTask } from "./aiTaskProcessor.js";

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

export interface ExtractedTaskFilterResult {
  visibleTasks: ExtractedTask[];
  hiddenExisting: number;
  hiddenDismissed: number;
  hiddenDuplicates: number;
}

export type DashboardTaskSection =
  | "overdue"
  | "today"
  | "upcoming"
  | "scheduled"
  | "backlog"
  | "done";

interface DashboardTaskView extends DashTask {
  relativePath: string;
  effectiveDate: string | null;
  section: DashboardTaskSection;
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
  done: 5,
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
  extractedTasks: ExtractedTask[],
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

  const visibleTasks: ExtractedTask[] = [];
  let hiddenExisting = 0;
  let hiddenDismissed = 0;
  let hiddenDuplicates = 0;

  for (const task of extractedTasks) {
    const key = normalizeExtractedTaskIdentity(task.text);
    if (!key) {
      hiddenDuplicates++;
      continue;
    }

    if (seenKeys.has(key)) {
      hiddenDuplicates++;
      continue;
    }
    seenKeys.add(key);

    if (existingKeys.has(key)) {
      hiddenExisting++;
      continue;
    }

    if (dismissedKeys.has(key)) {
      hiddenDismissed++;
      continue;
    }

    visibleTasks.push(task);
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

function buildDashboardTaskViews(tasks: DashTask[], today: string): DashboardTaskView[] {
  const horizonDate = shiftDate(today, 7);
  return tasks
    .map((task) => {
      const relativePath = getRelativePathFromTaskId(task.id, task.filePath);
      const effectiveDate = task.dueDate ?? task.date;
      return {
        ...task,
        relativePath,
        effectiveDate,
        section: classifyDashboardTask(task, today, horizonDate),
      };
    })
    .sort(compareDashboardTasks);
}

function buildSectionCounts(tasks: DashboardTaskView[]): Record<DashboardTaskSection, number> {
  const counts: Record<DashboardTaskSection, number> = {
    overdue: 0,
    today: 0,
    upcoming: 0,
    scheduled: 0,
    backlog: 0,
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
        const { text, dueDate, targetDate } = message as {
          text: string;
          dueDate?: string | null;
          targetDate?: string | null;
        };
        void this._createTask(text, normalizeOptionalDate(targetDate), normalizeOptionalDate(dueDate));
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
  ): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const normalizedText = upsertDashboardDueDate(text, dueDate);
    if (!normalizedText) {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return;
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

      const extracted = await extractTasksFromMoments(cleanText, token);
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
          message: buildExtractedTaskStatusMessage(filtered),
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
  <div class="week-day-bars">
    <div class="week-bar week-bar-done" style="height:${doneHeight}%"></div>
    <div class="week-bar week-bar-open" style="height:${openHeight}%"></div>
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
  <div class="category-track"><div class="category-fill" style="width:${width}%"></div></div>
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
    --surface-muted: color-mix(in srgb, var(--vscode-editorWidget-background, #161b22) 92%, var(--vscode-textLink-foreground, #4f8cff) 8%);
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
    gap: var(--gap);
  }

  .hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap);
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-muted);
  }

  .hero-copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .eyebrow {
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .hero-title {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    text-wrap: balance;
  }

  .hero-subtitle {
    margin: 0;
    color: var(--muted);
    max-width: 60ch;
    text-wrap: pretty;
  }

  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    align-items: center;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;
  }

  .pill strong {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    min-width: 0;
  }

  .summary-card.is-accent {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  }

  .summary-card.is-warning {
    border-color: color-mix(in srgb, var(--warning) 40%, var(--border));
  }

  .summary-label {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .summary-value {
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .summary-note {
    color: var(--muted);
    font-size: 12px;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(320px, 1fr);
    gap: var(--gap);
    align-items: start;
  }

  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 18px;
  }

  .card + .card {
    margin-top: var(--gap);
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .card-header h2,
  .card-header h3 {
    margin: 4px 0 0;
    font-size: 18px;
    line-height: 1.3;
  }

  .card-header p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 13px;
  }

  .card-header .eyebrow {
    font-size: 10px;
  }

  .card-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .task-toolbar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 14px;
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
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0 12px;
    min-height: 42px;
    background: color-mix(in srgb, var(--surface) 90%, var(--bg));
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

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .task-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
    gap: 10px;
  }

  .task-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 92%, var(--bg));
  }

  .task-item.is-overdue {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }

  .task-item.is-today {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  .task-item.is-done {
    opacity: 0.76;
  }

  .task-check {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-top: 2px;
    flex-shrink: 0;
  }

  .task-check input {
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

  .task-check input:checked {
    background: color-mix(in srgb, var(--success) 16%, transparent);
    border-color: color-mix(in srgb, var(--success) 55%, var(--border));
  }

  .task-check input:checked::after {
    content: "";
    position: absolute;
    inset: 4px;
    background: var(--success);
    clip-path: polygon(14% 52%, 0 67%, 39% 100%, 100% 22%, 84% 8%, 39% 68%);
  }

  .task-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .task-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .task-title {
    margin: 0;
    border: none;
    padding: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    min-width: 0;
  }

  .task-title:hover {
    color: var(--accent);
  }

  .task-item.is-done .task-title {
    color: var(--muted);
    text-decoration: line-through;
  }

  .task-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
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

  .task-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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

  .field,
  .field-compact {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
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
    padding: 18px;
    color: var(--muted);
    text-align: center;
  }

  .side-column {
    min-width: 0;
  }

  .analytics-grid {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .week-chart {
    display: flex;
    gap: 10px;
    align-items: stretch;
    min-height: 150px;
  }

  .week-day {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 8px;
  }

  .week-day-bars {
    height: 108px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 3px;
    padding: 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    border: 1px solid var(--border);
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
    margin-top: 12px;
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

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 70%, transparent);
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
    justify-content: space-between;
    gap: 10px;
    align-items: flex-start;
  }

  .extract-title {
    font-weight: 600;
    font-size: 13px;
  }

  .extract-meta {
    color: var(--muted);
    font-size: 12px;
  }

  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    body {
      padding: 14px;
    }

    .hero {
      flex-direction: column;
    }

    .hero-meta {
      justify-content: flex-start;
    }

    .summary-grid,
    .field-grid {
      grid-template-columns: 1fr;
    }

    .task-head,
    .extract-head {
      flex-direction: column;
    }

    .task-actions {
      justify-content: flex-start;
    }
  }
</style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Capture, Manage, Review</div>
        <h1 class="hero-title">Task Dashboard</h1>
        <p class="hero-subtitle">Moments や Notes から生まれるタスクを、手動で整えながら見える化する画面です。日付指定が空なら inbox、日付を入れればその日のタスクファイルへ保存します。</p>
      </div>
      <div class="hero-meta">
        <div class="pill"><strong class="mono">${escHtml(data.today)}</strong><span>Today</span></div>
        <div class="pill"><strong>${data.tasks.length}</strong><span>Total tasks</span></div>
        <button class="btn" id="btn-refresh" type="button">Refresh</button>
      </div>
    </section>

    <section class="summary-grid">
      <article class="summary-card is-accent">
        <div class="summary-label">Open</div>
        <div class="summary-value">${data.summary.totalOpen}</div>
        <div class="summary-note">未完了タスク全体</div>
      </article>
      <article class="summary-card is-accent">
        <div class="summary-label">Attention</div>
        <div class="summary-value">${data.summary.attentionCount}</div>
        <div class="summary-note">overdue / today / 7日以内</div>
      </article>
      <article class="summary-card is-warning">
        <div class="summary-label">Overdue</div>
        <div class="summary-value">${data.summary.overdueCount}</div>
        <div class="summary-note">期限超過または過去日付の未完了</div>
      </article>
      <article class="summary-card">
        <div class="summary-label">Completion</div>
        <div class="summary-value">${data.summary.completionRate}%</div>
        <div class="summary-note">${data.summary.totalDone} 件が完了済み</div>
      </article>
    </section>

    <div class="layout">
      <section class="card">
        <div class="card-header">
          <div>
            <div class="eyebrow">Task Workspace</div>
            <h2>Daily operations</h2>
            <p>検索、絞り込み、インライン編集、削除、元ファイルへのジャンプまでここで完結します。</p>
          </div>
          <div class="card-meta"><span class="mono">${data.summary.totalOpen}</span><span>open now</span></div>
        </div>

        <div class="task-toolbar">
          <div class="filter-row" id="filter-row"></div>
          <label class="search-shell" aria-label="Search tasks">
            <span>Search</span>
            <input id="task-search" type="search" placeholder="text, tag, file path, date" />
          </label>
        </div>

        <div class="task-list" id="task-list"></div>
      </section>

      <aside class="side-column">
        <section class="card">
          <div class="card-header">
            <div>
              <div class="eyebrow">Composer</div>
              <h3>Create anywhere</h3>
              <p>当日固定ではなく、inbox でも未来日でも直接作れます。</p>
            </div>
          </div>
          <div class="field">
            <span>Task</span>
            <textarea id="new-task-text" placeholder="例: 見積もりを送る #work"></textarea>
          </div>
          <div class="field-grid" style="margin-top:12px">
            <label class="field-compact">
              <span>Save In Date File</span>
              <input id="new-task-target-date" type="date" />
            </label>
            <label class="field-compact">
              <span>Due</span>
              <input id="new-task-due-date" type="date" />
            </label>
          </div>
          <p class="helper" id="composer-target-preview" style="margin-top:10px">保存先: tasks/inbox.md</p>
          <div class="inline-actions" style="margin-top:14px">
            <button class="btn btn-primary" id="btn-create-task" type="button">Add Task</button>
            <button class="btn" id="btn-clear-task" type="button">Clear</button>
          </div>
        </section>

        <div class="analytics-grid">
          <section class="card">
            <div class="card-header">
              <div>
                <div class="eyebrow">Upcoming Load</div>
                <h3>Next 7 days</h3>
              </div>
            </div>
            <div class="week-chart">${weekBarsHtml}</div>
            <div class="chart-legend">
              <span><span class="legend-dot" style="background:color-mix(in srgb, var(--success) 60%, transparent)"></span>Done</span>
              <span><span class="legend-dot" style="background:color-mix(in srgb, var(--accent) 55%, transparent)"></span>Open</span>
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <div>
                <div class="eyebrow">Open Mix</div>
                <h3>Category balance</h3>
              </div>
            </div>
            <div class="category-list">${categoryHtml}</div>
          </section>

          <section class="card">
            <div class="card-header">
              <div>
                <div class="eyebrow">Moments Intake</div>
                <h3>Extract from Moments</h3>
                <p>任意の日付の Moments から、まだタスク化していない候補だけを抽出します。追加先は Composer の保存先を使います。</p>
              </div>
            </div>
            <label class="field-compact" style="margin-top:8px">
              <span>Moments Source Date</span>
              <input id="ai-source-date" type="date" value="${escAttr(data.today)}" />
            </label>
            <div class="inline-actions" style="margin-top:16px">
              <button class="btn btn-primary" id="btn-ai-extract" type="button">Extract Tasks</button>
            </div>
            <div class="status-line" id="ai-status"></div>
            <div class="ai-result" id="ai-result"></div>
          </section>
        </div>
      </aside>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const dashboardData = ${payload};
    const savedState = vscode.getState() || {};
    const state = {
      filter: savedState.filter === "focus" ? "attention" : (savedState.filter || "attention"),
      search: savedState.search || "",
      targetDate: savedState.targetDate || "",
      composerText: savedState.composerText || "",
      composerDueDate: savedState.composerDueDate || "",
      aiSourceDate: savedState.aiSourceDate || dashboardData.today,
      editingId: savedState.editingId || null,
      extractedTasks: Array.isArray(savedState.extractedTasks) ? savedState.extractedTasks : [],
      addedExtractedKeys: Array.isArray(savedState.addedExtractedKeys) ? savedState.addedExtractedKeys : [],
      aiStatus: savedState.aiStatus || "",
      aiStatusType: savedState.aiStatusType || "idle",
    };

    const sectionTitles = {
      overdue: "Overdue",
      today: "Today",
      upcoming: "Upcoming",
      scheduled: "Scheduled",
      backlog: "Backlog",
      done: "Done",
    };
    const sectionDescriptions = {
      overdue: "過去日付または期限超過",
      today: "今日着手するタスク",
      upcoming: "7日以内に近づくタスク",
      scheduled: "先の予定に置いているタスク",
      backlog: "inbox や日付なしの棚卸し待ち",
      done: "完了済み",
    };
    const sectionOrder = ["overdue", "today", "upcoming", "scheduled", "backlog", "done"];

    const filterDefinitions = [
      { id: "attention", label: "Attention", count: dashboardData.sectionCounts.overdue + dashboardData.sectionCounts.today + dashboardData.sectionCounts.upcoming },
      { id: "all", label: "All", count: dashboardData.tasks.length },
      { id: "overdue", label: "Overdue", count: dashboardData.sectionCounts.overdue },
      { id: "today", label: "Today", count: dashboardData.sectionCounts.today },
      { id: "upcoming", label: "Upcoming", count: dashboardData.sectionCounts.upcoming },
      { id: "scheduled", label: "Scheduled", count: dashboardData.sectionCounts.scheduled },
      { id: "backlog", label: "Backlog", count: dashboardData.sectionCounts.backlog },
      { id: "done", label: "Done", count: dashboardData.sectionCounts.done },
    ];

    const taskSearchInput = document.getElementById("task-search");
    const filterRow = document.getElementById("filter-row");
    const taskList = document.getElementById("task-list");
    const newTaskText = document.getElementById("new-task-text");
    const newTaskTargetDate = document.getElementById("new-task-target-date");
    const newTaskDueDate = document.getElementById("new-task-due-date");
    const composerTargetPreview = document.getElementById("composer-target-preview");
    const aiSourceDateInput = document.getElementById("ai-source-date");
    const aiStatus = document.getElementById("ai-status");
    const aiResult = document.getElementById("ai-result");

    function persistState() {
      vscode.setState({
        filter: state.filter,
        search: state.search,
        targetDate: state.targetDate,
        composerText: state.composerText,
        composerDueDate: state.composerDueDate,
        aiSourceDate: state.aiSourceDate,
        editingId: state.editingId,
        extractedTasks: state.extractedTasks,
        addedExtractedKeys: state.addedExtractedKeys,
        aiStatus: state.aiStatus,
        aiStatusType: state.aiStatusType,
      });
    }

    function esc(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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

    function extractedTaskKey(task) {
      return normalizeTaskIdentity(task.text);
    }

    function normalizeTaskIdentity(text) {
      return String(text || "")
        .replace(/\s*(?:📅|due:|@)(\d{4}-\d{2}-\d{2})\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .normalize("NFKC")
        .toLowerCase();
    }

    function getSaveTargetLabel() {
      return state.targetDate ? "tasks/" + state.targetDate + ".md" : "tasks/inbox.md";
    }

    function updateComposerPreview() {
      composerTargetPreview.textContent = "保存先: " + getSaveTargetLabel();
    }

    function getExistingTaskKeys() {
      return new Set(
        (dashboardData.tasks || [])
          .map(function (task) {
            return normalizeTaskIdentity(task.text);
          })
          .filter(Boolean),
      );
    }

    function matchesFilter(task) {
      if (state.filter === "all") {
        return true;
      }

      if (state.filter === "attention" || state.filter === "focus") {
        return task.section === "overdue" || task.section === "today" || task.section === "upcoming";
      }

      return task.section === state.filter;
    }

    function matchesSearch(task) {
      if (!state.search) {
        return true;
      }

      const query = state.search.toLowerCase();
      const haystack = [
        task.text,
        task.relativePath,
        task.date || "",
        task.dueDate || "",
        ...(task.tags || []),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    }

    function getVisibleTasks() {
      return dashboardData.tasks.filter(function (task) {
        return matchesFilter(task) && matchesSearch(task);
      });
    }

    function renderFilters() {
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
      badges.push('<span class="badge">' + esc(task.relativePath) + "</span>");
      if (task.date) {
        badges.push('<span class="badge">' + esc(formatDateLabel(task.date)) + "</span>");
      }
      if (task.dueDate) {
        const dueClass = task.section === "overdue" ? " is-danger" : task.section === "today" ? " is-warning" : " is-accent";
        badges.push('<span class="badge' + dueClass + '">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>");
      }
      for (const tag of task.tags || []) {
        badges.push('<span class="badge is-accent">' + esc(tag) + "</span>");
      }
      return badges.join("");
    }

    function renderTaskItem(task) {
      const itemClasses = [
        "task-item",
        task.done ? "is-done" : "",
        task.section === "overdue" ? "is-overdue" : "",
        task.section === "today" ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (state.editingId === task.id) {
        return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '">' +
          '<label class="task-check"><input type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
          '<div class="task-body">' +
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

      return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '">' +
        '<label class="task-check"><input type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
        '<div class="task-body">' +
          '<div class="task-head">' +
            '<button type="button" class="task-title" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">' + esc(task.text) + "</button>" +
            '<div class="task-actions">' +
              '<button type="button" class="text-btn" data-action="edit" data-task-id="' + esc(task.id) + '">Edit</button>' +
              '<button type="button" class="text-btn" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">Open</button>' +
              '<button type="button" class="text-btn is-danger" data-action="delete" data-task-id="' + esc(task.id) + '">Delete</button>' +
            "</div>" +
          "</div>" +
          '<div class="task-meta">' + renderTaskMeta(task) + "</div>" +
        "</div>" +
      "</article>";
    }

    function renderTasks() {
      const visibleTasks = getVisibleTasks();
      if (visibleTasks.length === 0) {
        taskList.innerHTML = '<div class="empty-state">該当するタスクはありません。検索条件を変えるか、右側の Composer から追加してください。</div>';
        return;
      }

      const groups = {};
      for (const section of sectionOrder) {
        groups[section] = [];
      }

      for (const task of visibleTasks) {
        groups[task.section].push(task);
      }

      const html = sectionOrder
        .filter(function (section) {
          return groups[section].length > 0;
        })
        .map(function (section) {
          const items = groups[section].map(renderTaskItem).join("");
          return '<section class="task-section">' +
            '<div class="task-section-header">' +
              "<h3>" + esc(sectionTitles[section]) + "</h3>" +
              "<span>" + groups[section].length + " · " + esc(sectionDescriptions[section]) + "</span>" +
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

    function renderExtractResult() {
      const existingTaskKeys = getExistingTaskKeys();
      const visibleItems = (state.extractedTasks || [])
        .map(function (task, index) {
          if (existingTaskKeys.has(extractedTaskKey(task))) {
            return "";
          }

          const key = extractedTaskKey(task);
          const isAdded = state.addedExtractedKeys.includes(key);
          const dueBadge = task.dueDate
            ? '<span class="badge is-accent">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>"
            : "";
          return '<div class="extract-item">' +
            '<div class="extract-head">' +
              '<div>' +
                '<div class="extract-title">' + esc(task.text) + "</div>" +
                '<div class="extract-meta">' + esc(task.category) + " · " + esc(task.priority) + " · ~" + esc(String(task.timeEstimateMin)) + " min</div>" +
              "</div>" +
              '<div class="inline-actions">' +
                dueBadge +
                '<button type="button" class="btn btn-primary"' + (isAdded ? " disabled" : "") + ' data-action="add-extracted" data-index="' + index + '">' + (isAdded ? "Added" : "Add") + "</button>" +
                '<button type="button" class="btn" data-action="dismiss-extracted" data-index="' + index + '">Hide for now</button>' +
              "</div>" +
            "</div>" +
          "</div>";
        })
        .filter(Boolean)
        .join("");

      if (!visibleItems) {
        aiResult.innerHTML = "";
        return;
      }

      aiResult.innerHTML = '<div class="helper">抽出したタスクは Composer の保存先を使って追加します。既存タスクと重複する候補は自動で隠します。現在の保存先: ' + esc(getSaveTargetLabel()) + "</div>" + visibleItems;
    }

    function renderAiResult() {
      renderExtractResult();
    }

    function syncStaticInputs() {
      taskSearchInput.value = state.search;
      newTaskText.value = state.composerText;
      newTaskTargetDate.value = state.targetDate;
      newTaskDueDate.value = state.composerDueDate;
      aiSourceDateInput.value = state.aiSourceDate;
      updateComposerPreview();
      setAiStatus(state.aiStatusType, state.aiStatus);
    }

    function rerender() {
      persistState();
      renderFilters();
      renderTasks();
      renderAiResult();
      updateComposerPreview();
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

      state.composerText = "";
      persistState();
      vscode.postMessage({
        command: "createTask",
        text,
        targetDate: state.targetDate || null,
        dueDate: state.composerDueDate || null,
      });
    });

    document.getElementById("btn-ai-extract").addEventListener("click", function () {
      state.extractedTasks = [];
      state.addedExtractedKeys = [];
      setAiStatus("processing", state.aiSourceDate + " の Moments を分析しています...");
      renderAiResult();
      vscode.postMessage({ command: "aiExtract", sourceDate: state.aiSourceDate });
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
      if (Number.isNaN(index) || !state.extractedTasks[index]) {
        return;
      }

      const task = state.extractedTasks[index];
      const key = extractedTaskKey(task);
      if (!state.addedExtractedKeys.includes(key)) {
        state.addedExtractedKeys = state.addedExtractedKeys.concat([key]);
        persistState();
      }

      vscode.postMessage({
        command: "addExtractedTask",
        text: task.text,
        dueDate: task.dueDate || null,
        targetDate: state.targetDate || null,
      });
      renderAiResult();
    }

    function handleDismissExtractedAction(actionEl) {
      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);
      if (Number.isNaN(index) || !state.extractedTasks[index]) {
        return;
      }

      const task = state.extractedTasks[index];
      state.extractedTasks = state.extractedTasks.filter(function (_task, taskIndex) {
        return taskIndex !== index;
      });
      persistState();
      vscode.postMessage({
        command: "dismissExtractedTask",
        text: task.text,
      });
      renderAiResult();
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

      if (action === "add-extracted") {
        handleAddExtractedAction(actionEl);
        return;
      }

      if (action === "dismiss-extracted") {
        handleDismissExtractedAction(actionEl);
      }
    });

    aiResult.addEventListener("click", function (event) {
      const actionEl = event.target.closest("[data-action='add-extracted'], [data-action='dismiss-extracted']");
      if (!actionEl) {
        return;
      }

      if (actionEl.dataset.action === "dismiss-extracted") {
        handleDismissExtractedAction(actionEl);
        return;
      }

      handleAddExtractedAction(actionEl);
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
        renderAiResult();
        return;
      }

      if (message.type === "extractResult") {
        state.extractedTasks = message.tasks || [];
        state.addedExtractedKeys = [];
        renderAiResult();
      }
    });

    syncStaticInputs();
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
