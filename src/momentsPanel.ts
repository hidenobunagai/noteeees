import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildQueryExcerpt } from "./noteCommands";

export interface MomentEntry {
  index: number; // 0-based line index in the body
  time: string; // HH:mm
  text: string; // content after the time
  isTask: boolean;
  done: boolean;
  tags?: string[];
}

export interface MomentDaySection {
  date: string;
  dateLabel: string;
  isToday: boolean;
  entries: MomentEntry[];
}

export interface TaskOverviewItem {
  date: string;
  time: string;
  text: string;
  filePath: string;
  relativePath: string;
  fileLineIndex: number;
  done: boolean;
}

interface OpenTaskQuickPickItem extends vscode.QuickPickItem {
  task: TaskOverviewItem;
}

export type MomentFilter = "all" | "openTasks";
export type InboxTaskFilter = "all" | "open" | "done";

const MOMENTS_FEED_DAY_COUNT = 7;
const MOMENT_TAG_PATTERN = String.raw`#[\p{L}\p{M}\p{N}_\p{Pd}]+`;

let lastInboxTaskFilter: InboxTaskFilter = "all";

function matchMomentTags(text: string): string[] {
  return text.match(new RegExp(MOMENT_TAG_PATTERN, "gu")) ?? [];
}

function normalizeMomentTag(tag: string): string {
  return tag.normalize("NFKC").toLowerCase();
}

export function normalizeInboxTaskFilter(filter: string | undefined): InboxTaskFilter {
  if (filter === "open" || filter === "done" || filter === "all") {
    return filter;
  }

  return "all";
}

export function filterMomentEntries(entries: MomentEntry[], filter: MomentFilter): MomentEntry[] {
  if (filter === "openTasks") {
    return entries.filter((entry) => entry.isTask && !entry.done);
  }

  return entries;
}

export function extractMomentTags(text: string): string[] {
  return [...new Set(matchMomentTags(text).map((tag) => normalizeMomentTag(tag)))];
}

export function filterTaskOverviewItems(
  items: TaskOverviewItem[],
  filter: InboxTaskFilter,
): TaskOverviewItem[] {
  if (filter === "open") {
    return items.filter((item) => !item.done);
  }

  if (filter === "done") {
    return items.filter((item) => item.done);
  }

  return items;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function getMomentsSubfolder(): string {
  const config = vscode.workspace.getConfiguration("notes");
  return config.get<string>("momentsSubfolder") || "moments";
}

function getSendOnEnter(): boolean {
  const config = vscode.workspace.getConfiguration("notes");
  return config.get<boolean>("momentsSendOnEnter") ?? true;
}

export function normalizeMomentsFeedDayCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MOMENTS_FEED_DAY_COUNT;
  }

  return Math.min(Math.max(Math.floor(value), 1), 30);
}

function getMomentsFeedDayCount(): number {
  const config = vscode.workspace.getConfiguration("notes");
  return normalizeMomentsFeedDayCount(config.get<number>("momentsFeedDays"));
}

function getConfiguredInboxTaskFilter(): InboxTaskFilter {
  const config = vscode.workspace.getConfiguration("notes");
  return normalizeInboxTaskFilter(config.get<string>("momentsInboxFilter"));
}

function persistInboxTaskFilter(filter: InboxTaskFilter): Thenable<void> {
  lastInboxTaskFilter = filter;
  return vscode.workspace
    .getConfiguration("notes")
    .update("momentsInboxFilter", filter, vscode.ConfigurationTarget.Global);
}

function getMomentsFilePath(notesDir: string, date: string): string {
  const subfolder = getMomentsSubfolder();
  return path.join(notesDir, subfolder, `${date}.md`);
}

function getMomentsDirectory(notesDir: string): string {
  return path.join(notesDir, getMomentsSubfolder());
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function offsetDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function buildMomentsFeedDates(
  anchorDate: string,
  dayCount: number = MOMENTS_FEED_DAY_COUNT,
): string[] {
  const safeDayCount = normalizeMomentsFeedDayCount(dayCount);
  return Array.from({ length: safeDayCount }, (_, index) => offsetDate(anchorDate, -index));
}

function readMoments(notesDir: string, date: string): MomentEntry[] {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  // Strip front matter only — do NOT trim, so line indices stay consistent with toggleTask
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split("\n");
  const entries: MomentEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    // Task done:   - [x] HH:mm text
    // Task todo:   - [ ] HH:mm text
    // Regular:     - HH:mm text
    const taskDone = line.match(/^-\s+\[x\]\s+(\d{2}:\d{2})\s+(.*)/i);
    const taskTodo = line.match(/^-\s+\[ \]\s+(\d{2}:\d{2})\s+(.*)/i);
    const regular = line.match(/^-\s+(\d{2}:\d{2})\s+(.*)/);

    if (taskDone) {
      entries.push({
        index: i,
        time: taskDone[1],
        text: taskDone[2],
        isTask: true,
        done: true,
        tags: extractMomentTags(taskDone[2]),
      });
    } else if (taskTodo) {
      entries.push({
        index: i,
        time: taskTodo[1],
        text: taskTodo[2],
        isTask: true,
        done: false,
        tags: extractMomentTags(taskTodo[2]),
      });
    } else if (regular) {
      entries.push({
        index: i,
        time: regular[1],
        text: regular[2],
        isTask: false,
        done: false,
        tags: extractMomentTags(regular[2]),
      });
    }
  }

  return entries;
}

export function mapMomentBodyIndexToFileLine(raw: string, bodyIndex: number): number {
  let bodyStart = 0;
  if (raw.startsWith("---")) {
    const fmEnd = raw.indexOf("\n---", 3);
    if (fmEnd !== -1) {
      bodyStart = raw.slice(0, fmEnd + 4).split("\n").length;
    }
  }

  return bodyStart + bodyIndex;
}

export function toggleMomentTaskLine(line: string): { line: string; changed: boolean } {
  if (line.match(/^(-\s+)\[x\]/i)) {
    return {
      line: line.replace(/^(-\s+)\[x\]/i, "$1[ ]"),
      changed: true,
    };
  }

  if (line.match(/^(-\s+)\[ \]/)) {
    return {
      line: line.replace(/^(-\s+)\[ \]/, "$1[x]"),
      changed: true,
    };
  }

  return { line, changed: false };
}

export function convertMomentLineToTask(line: string): { line: string; changed: boolean } {
  const regular = line.match(/^(-\s+)(\d{2}:\d{2}\s+.*)$/);
  if (!regular) {
    return { line, changed: false };
  }

  return {
    line: `${regular[1]}[ ] ${regular[2]}`,
    changed: true,
  };
}

export function convertMomentLineToNote(line: string): { line: string; changed: boolean } {
  const task = line.match(/^(-\s+)\[(x| )\]\s+(\d{2}:\d{2}\s+.*)$/i);
  if (!task) {
    return { line, changed: false };
  }

  return {
    line: `${task[1]}${task[3]}`,
    changed: true,
  };
}

export function replaceMomentEntryText(
  line: string,
  nextText: string,
): { line: string; changed: boolean } {
  const normalizedText = nextText.trim();
  if (!normalizedText) {
    return { line, changed: false };
  }

  const taskDone = line.match(/^(-\s+\[x\]\s+)(\d{2}:\d{2})\s+(.*)$/i);
  if (taskDone) {
    return {
      line: `${taskDone[1]}${taskDone[2]} ${normalizedText}`,
      changed: taskDone[3] !== normalizedText,
    };
  }

  const taskTodo = line.match(/^(-\s+\[ \]\s+)(\d{2}:\d{2})\s+(.*)$/);
  if (taskTodo) {
    return {
      line: `${taskTodo[1]}${taskTodo[2]} ${normalizedText}`,
      changed: taskTodo[3] !== normalizedText,
    };
  }

  const regular = line.match(/^(-\s+)(\d{2}:\d{2})\s+(.*)$/);
  if (regular) {
    return {
      line: `${regular[1]}${regular[2]} ${normalizedText}`,
      changed: regular[3] !== normalizedText,
    };
  }

  return { line, changed: false };
}

export function deleteMomentLine(
  lines: string[],
  lineIndex: number,
): {
  lines: string[];
  changed: boolean;
} {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return { lines, changed: false };
  }

  return {
    lines: [...lines.slice(0, lineIndex), ...lines.slice(lineIndex + 1)],
    changed: true,
  };
}

function compareOpenTaskOverview<T extends { date: string; time: string; done?: boolean }>(
  a: T,
  b: T,
): number {
  if ((a.done ?? false) !== (b.done ?? false)) {
    return Number(a.done ?? false) - Number(b.done ?? false);
  }

  const dateCompare = b.date.localeCompare(a.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }

  return b.time.localeCompare(a.time);
}

export function sortOpenTaskOverview<T extends { date: string; time: string; done?: boolean }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => compareOpenTaskOverview(a, b));
}

export function buildMomentsDateLabel(date: string, today: string): string {
  if (date === today) {
    return `Today · ${date}`;
  }

  return date;
}

function collectMomentsFeed(notesDir: string, anchorDate: string): MomentDaySection[] {
  const today = formatDate(new Date());
  const feedDayCount = getMomentsFeedDayCount();

  return buildMomentsFeedDates(anchorDate, feedDayCount)
    .map((date) => ({
      date,
      dateLabel: buildMomentsDateLabel(date, today),
      isToday: date === today,
      entries: readMoments(notesDir, date),
    }))
    .filter((section, index) => index === 0 || section.entries.length > 0);
}

function openOpenTaskItem(item: TaskOverviewItem): Thenable<vscode.TextEditor> {
  return vscode.workspace.openTextDocument(item.filePath).then((doc) => {
    return vscode.window.showTextDocument(doc).then((editor) => {
      const line = Math.min(item.fileLineIndex, Math.max(0, doc.lineCount - 1));
      const range = doc.lineAt(line).range;
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      return editor;
    });
  });
}

function toggleTaskAtFileLine(filePath: string, fileLineIndex: number): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  if (fileLineIndex < 0 || fileLineIndex >= lines.length) {
    return false;
  }

  const result = toggleMomentTaskLine(lines[fileLineIndex]);
  if (!result.changed) {
    return false;
  }

  lines[fileLineIndex] = result.line;
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return true;
}

export function buildTaskSearchDetail(item: TaskOverviewItem, query: string = ""): string {
  const details = [`${item.relativePath}:${item.fileLineIndex + 1}`];
  const normalizedQuery = query.trim();

  if (normalizedQuery) {
    const excerpt = buildQueryExcerpt(
      `${item.relativePath} ${item.date} ${item.time} ${item.done ? "done" : "open"} ${item.text}`,
      normalizedQuery,
      90,
    );
    if (excerpt) {
      details.push(excerpt);
    }
  }

  return details.join("  •  ");
}

function toOpenTaskQuickPickItem(
  item: TaskOverviewItem,
  query: string = "",
): OpenTaskQuickPickItem {
  return {
    label: `$(checklist) ${item.text}`,
    description: `${item.date} • ${item.time} • ${item.done ? "Done" : "Open"}`,
    detail: buildTaskSearchDetail(item, query),
    buttons: [
      {
        iconPath: new vscode.ThemeIcon(item.done ? "circle-large-outline" : "check"),
        tooltip: item.done ? "Mark task as open" : "Mark task as done",
      },
    ],
    task: item,
  };
}

export function getNextInboxFilter(filter: InboxTaskFilter): InboxTaskFilter {
  if (filter === "all") {
    return "open";
  }

  if (filter === "open") {
    return "done";
  }

  return "all";
}

function getInboxFilterLabel(filter: InboxTaskFilter): string {
  if (filter === "open") {
    return "Open Only";
  }

  if (filter === "done") {
    return "Done Only";
  }

  return "All Tasks";
}

function buildInboxFilterButton(filter: InboxTaskFilter): vscode.QuickInputButton {
  return {
    iconPath: new vscode.ThemeIcon("filter"),
    tooltip: `Switch inbox filter (${getInboxFilterLabel(filter)})`,
  };
}

function collectOpenTaskOverview(notesDir: string): TaskOverviewItem[] {
  const momentsDir = getMomentsDirectory(notesDir);
  if (!fs.existsSync(momentsDir)) {
    return [];
  }

  const files = fs.readdirSync(momentsDir, { withFileTypes: true });
  const items: TaskOverviewItem[] = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".md")) {
      continue;
    }

    const date = path.basename(file.name, ".md");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue;
    }

    const filePath = path.join(momentsDir, file.name);
    const raw = fs.readFileSync(filePath, "utf8");
    const entries = readMoments(notesDir, date);

    for (const entry of entries) {
      if (entry.isTask) {
        items.push({
          date,
          time: entry.time,
          text: entry.text,
          filePath,
          relativePath: path.relative(notesDir, filePath),
          fileLineIndex: mapMomentBodyIndexToFileLine(raw, entry.index),
          done: entry.done,
        });
      }
    }
  }

  return sortOpenTaskOverview(items);
}

export async function showOpenTasksOverview(notesDir: string): Promise<void> {
  const quickPick = vscode.window.createQuickPick<OpenTaskQuickPickItem>();
  let activeFilter: InboxTaskFilter = getConfiguredInboxTaskFilter();
  lastInboxTaskFilter = activeFilter;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.buttons = [buildInboxFilterButton(activeFilter)];

  const refreshItems = (query: string = quickPick.value): number => {
    const items = collectOpenTaskOverview(notesDir);
    const filteredItems = filterTaskOverviewItems(items, activeFilter);
    quickPick.title = `Moments Inbox • ${getInboxFilterLabel(activeFilter)}`;
    quickPick.buttons = [buildInboxFilterButton(activeFilter)];
    quickPick.items = filteredItems.map((item) => toOpenTaskQuickPickItem(item, query));
    const openCount = items.filter((item) => !item.done).length;
    const doneCount = items.length - openCount;

    if (filteredItems.length === 0 && items.length > 0) {
      quickPick.placeholder = `No ${getInboxFilterLabel(activeFilter).toLowerCase()} match the current filter. Type to search by text, date, state, or file.`;
    } else {
      quickPick.placeholder = `${openCount} open • ${doneCount} done across Moments. Type to filter by text, date, state, or file.`;
    }

    return items.length;
  };

  if (refreshItems() === 0) {
    quickPick.dispose();
    vscode.window.showInformationMessage("No tasks across Moments.");
    return;
  }

  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (!selected) {
      return;
    }

    void openOpenTaskItem(selected.task);
    quickPick.hide();
  });

  quickPick.onDidChangeValue((value) => {
    refreshItems(value);
  });

  quickPick.onDidTriggerButton(() => {
    activeFilter = getNextInboxFilter(activeFilter);
    void persistInboxTaskFilter(activeFilter);
    refreshItems(quickPick.value);
  });

  quickPick.onDidTriggerItemButton((event) => {
    quickPick.busy = true;
    quickPick.enabled = false;

    try {
      toggleTaskAtFileLine(event.item.task.filePath, event.item.task.fileLineIndex);
      refreshItems(quickPick.value);
    } finally {
      quickPick.busy = false;
      quickPick.enabled = true;
    }
  });

  quickPick.onDidHide(() => {
    void persistInboxTaskFilter(activeFilter);
    quickPick.dispose();
  });

  quickPick.show();
}

function ensureMomentsFile(notesDir: string, date: string): string {
  const filePath = getMomentsFilePath(notesDir, date);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `---\ntype: moments\ndate: ${date}\n---\n\n`, "utf8");
  }
  return filePath;
}

function appendMoment(notesDir: string, date: string, text: string, isTask: boolean): void {
  const filePath = ensureMomentsFile(notesDir, date);
  const time = formatTime(new Date());
  const prefix = isTask ? `- [ ] ${time} ` : `- ${time} `;
  const entry = `${prefix}${text.trim()}\n`;

  let content = fs.readFileSync(filePath, "utf8");
  // Ensure ends with newline before appending
  if (!content.endsWith("\n")) {
    content += "\n";
  }
  fs.writeFileSync(filePath, content + entry, "utf8");
}

function toggleTask(notesDir: string, date: string, index: number): void {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  // Preserve front matter as-is; work on full file lines
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  if (fileLineIdx >= lines.length) {
    return;
  }

  const result = toggleMomentTaskLine(lines[fileLineIdx]);
  if (!result.changed) {
    return;
  }

  lines[fileLineIdx] = result.line;

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function convertMomentEntryToTask(notesDir: string, date: string, index: number): boolean {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  if (fileLineIdx < 0 || fileLineIdx >= lines.length) {
    return false;
  }

  const result = convertMomentLineToTask(lines[fileLineIdx]);
  if (!result.changed) {
    return false;
  }

  lines[fileLineIdx] = result.line;
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return true;
}

function convertMomentEntryToNote(notesDir: string, date: string, index: number): boolean {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  if (fileLineIdx < 0 || fileLineIdx >= lines.length) {
    return false;
  }

  const result = convertMomentLineToNote(lines[fileLineIdx]);
  if (!result.changed) {
    return false;
  }

  lines[fileLineIdx] = result.line;
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return true;
}

function saveMomentEdit(notesDir: string, date: string, index: number, text: string): boolean {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  if (fileLineIdx < 0 || fileLineIdx >= lines.length) {
    return false;
  }

  const result = replaceMomentEntryText(lines[fileLineIdx], text);
  if (!result.changed) {
    return false;
  }

  lines[fileLineIdx] = result.line;
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return true;
}

function deleteMomentEntry(notesDir: string, date: string, index: number): boolean {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  const result = deleteMomentLine(lines, fileLineIdx);
  if (!result.changed) {
    return false;
  }

  fs.writeFileSync(filePath, result.lines.join("\n"), "utf8");
  return true;
}

// ---------------------------------------------------------------------------
// WebviewViewProvider
// ---------------------------------------------------------------------------

export class MomentsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "notesMomentsView";

  private _view?: vscode.WebviewView;
  private readonly _getNotesDir: () => string | undefined;
  private readonly _extensionUri: vscode.Uri;

  constructor(getNotesDir: () => string | undefined, extensionUri: vscode.Uri) {
    this._getNotesDir = getNotesDir;
    this._extensionUri = extensionUri;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      const notesDir = this._getNotesDir();
      switch (message.command) {
        case "ready":
          this._sendEntries();
          break;

        case "addMoment": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }
          appendMoment(notesDir, formatDate(new Date()), message.text, message.isTask ?? false);
          this._sendEntries();
          break;
        }

        case "toggleTask": {
          if (!notesDir) {
            return;
          }
          toggleTask(notesDir, message.date ?? formatDate(new Date()), message.index);
          this._sendEntries();
          break;
        }

        case "convertToTask": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }

          if (
            !convertMomentEntryToTask(
              notesDir,
              message.date ?? formatDate(new Date()),
              message.index,
            )
          ) {
            this._showError("Could not convert that Moment into a task.");
            return;
          }

          this._sendEntries();
          break;
        }

        case "convertToNote": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }

          if (
            !convertMomentEntryToNote(
              notesDir,
              message.date ?? formatDate(new Date()),
              message.index,
            )
          ) {
            this._showError("Could not convert that task back into a Moment.");
            return;
          }

          this._sendEntries();
          break;
        }

        case "saveEdit": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }

          if (typeof message.text !== "string") {
            this._showError("Invalid Moment text.");
            return;
          }

          if (
            !saveMomentEdit(
              notesDir,
              message.date ?? formatDate(new Date()),
              message.index,
              message.text,
            )
          ) {
            this._showError("Could not save that Moment entry.");
            return;
          }

          this._sendEntries();
          break;
        }

        case "requestDeleteEntry": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }

          void vscode.window
            .showWarningMessage("Delete this Moment entry?", { modal: true }, "Delete")
            .then((selection) => {
              if (selection !== "Delete") {
                return;
              }

              if (
                !deleteMomentEntry(notesDir, message.date ?? formatDate(new Date()), message.index)
              ) {
                this._showError("Could not delete that Moment entry.");
                return;
              }

              this._sendEntries();
            });
          break;
        }

        case "openFile": {
          if (!notesDir) {
            return;
          }
          const currentDate = formatDate(new Date());
          const filePath = getMomentsFilePath(notesDir, currentDate);
          if (!fs.existsSync(filePath)) {
            ensureMomentsFile(notesDir, currentDate);
          }
          vscode.workspace.openTextDocument(filePath).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
          break;
        }

        case "showOpenTasksOverview": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }

          void showOpenTasksOverview(notesDir);
          break;
        }
      }
    });
  }

  public refresh(): void {
    this._sendEntries();
  }

  public focus(): void {
    this._view?.show(true);
  }

  private _sendEntries(): void {
    if (!this._view) {
      return;
    }
    const notesDir = this._getNotesDir();
    const today = formatDate(new Date());
    const sections = notesDir ? collectMomentsFeed(notesDir, today) : [];
    const sendOnEnter = getSendOnEnter();

    this._view.webview.postMessage({
      command: "update",
      sections,
      sendOnEnter,
    });
  }

  private _showError(msg: string): void {
    this._view?.webview.postMessage({ command: "error", message: msg });
  }

  private _getHtml(webview: vscode.Webview): string {
    const toolkitUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "toolkit.min.js"),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Moments</title>
<script type="module" src="${toolkitUri}"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ---- Top bar ---- */
  .topbar {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 6px 8px 4px;
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    flex-shrink: 0;
    gap: 4px;
  }

  .topbar-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .topbar-row-actions {
    display: flex;
    justify-content: center;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    padding: 2px;
    gap: 2px;
  }

  .nav-btn {
    flex: 1;
    text-align: center;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s;
  }
  .nav-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

  .nav-btn.active {
    opacity: 1;
    color: var(--vscode-foreground);
    background: var(--vscode-button-secondaryBackground, var(--vscode-badge-background));
    border-radius: 3px;
  }

  .open-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    opacity: 0.5;
    font-size: 12px;
    transition: opacity 0.15s;
  }
  .open-btn:hover { opacity: 1; }

  /* ---- Timeline ---- */
  .timeline {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    scroll-behavior: smooth;
  }

  .day-section {
    display: flex;
    flex-direction: column;
  }

  .day-section-header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 12px 6px;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .day-section-label {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }

  .day-section-label.is-today {
    color: var(--vscode-textLink-foreground);
  }

  .empty-state {
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    margin: 24px 12px 0;
    opacity: 0.6;
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px 8px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    transition: background 0.1s, border-color 0.1s;
    word-break: break-word;
  }
  .entry:hover { background: var(--vscode-list-hoverBackground); }

  .day-section .entry:last-child {
    border-bottom: none;
  }

  .entry-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .entry-time {
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .entry-main {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .entry-body {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }

  .entry-checkbox {
    flex: none;
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--vscode-textLink-foreground);
    cursor: pointer;
  }

  .entry-icon-wrapper {
    flex: none;
    width: 14px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 2px;
  }

  .entry-content {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .entry-body-content {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .entry.is-task.task-done {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 8%, var(--vscode-editor-background));
    border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 35%, var(--vscode-panel-border));
  }

  .entry.is-task.task-done .entry-text {
    color: var(--vscode-textLink-foreground);
    text-decoration: line-through;
  }

  .entry-text {
    line-height: 1.45;
    font-size: 12.5px;
  }

  .entry-edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .entry-edit textarea {
    margin-bottom: 0;
    min-height: 72px;
    max-height: 180px;
    font-size: 12.5px;
  }

  .entry-edit-actions,
  .entry-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .entry-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    font-size: 11px;
    opacity: 0.8;
    transition: color 0.15s, opacity 0.15s, background 0.15s;
  }

  .entry-action svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .entry-action:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    opacity: 1;
  }

  .entry-action.primary {
    color: var(--vscode-textLink-foreground);
  }

  .entry-action.danger:hover {
    color: var(--vscode-errorForeground);
  }

  .entry-action.save {
    color: var(--vscode-textLink-foreground);
  }

  .tag {
    display: inline-block;
    border: none;
    padding: 0 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
    color: var(--vscode-textLink-foreground);
    font-size: 11px;
    font-weight: 500;
    margin: 0 1px;
    text-decoration: none;
    font-family: inherit;
    line-height: 1.4;
    cursor: pointer;
  }

  .tag:hover {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 26%, transparent);
  }

  /* ---- Input area ---- */
  .input-area {
    flex-shrink: 0;
    padding: 8px 10px 10px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }

  .input-container {
    display: flex;
    flex-direction: column;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 6px;
    transition: border-color 0.2s ease, outline 0.2s ease;
  }

  .input-container:focus-within {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  textarea {
    display: block;
    width: 100%;
    resize: none;
    background: transparent;
    color: var(--vscode-input-foreground);
    border: none;
    padding: 8px 10px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.4;
    outline: none;
    min-height: 36px;
    max-height: 120px;
    overflow-y: auto;
  }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

  /* Bottom row: task toggle (left) + send button (right) */
  .input-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 6px 6px 8px;
    gap: 5px;
  }

  .task-toggle {
    display: inline-flex;
    align-items: center;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    opacity: 0.8;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    user-select: none;
  }
  .task-toggle.active {
    opacity: 1;
    color: var(--vscode-textLink-foreground);
  }
  .task-toggle:hover { opacity: 1; }

  .send-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: none;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    cursor: pointer;
    border-radius: 4px;
    padding: 0;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
    opacity: 0.8;
  }
  .send-icon-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    opacity: 1;
  }
  .send-icon-btn:active {
    background: var(--vscode-toolbar-activeBackground, rgba(90, 93, 94, 0.5));
  }
  .send-icon-btn svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.5;
    margin-top: 6px;
    text-align: right;
  }

  .error-banner {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-inputValidation-errorForeground);
    padding: 6px 10px;
    font-size: 11px;
    border-radius: 4px;
    margin-bottom: 6px;
  }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-row topbar-row-actions">
    <button class="nav-btn" id="allBtn" title="Show all recent moments">All</button>
    <button class="nav-btn" id="openTasksBtn" title="Show open tasks only">Open</button>
    <button class="nav-btn" id="inboxBtn" title="Show open tasks across all days">&#128230; Inbox</button>
    <button class="nav-btn active" id="activeTagBtn" title="Clear active hashtag filter" style="display:none"></button>
    <button class="open-btn" id="openFileBtn" title="Open today's file in editor">&#8599;</button>
  </div>
</div>

<div class="timeline" id="timeline">
  <div class="empty-state" id="emptyState">
  <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" style="opacity: 0.5; margin-bottom: 8px;">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2H1.5l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zM2 3h12v10H2V3zM4 6h8V5H4v1zm8 2H4v1h8V8zm-8 3h6v-1H4v1z" />
  </svg>
  <div>No moments yet today</div>
  <div style="font-size: 11px; margin-top: 4px; opacity: 0.8;">Capture ideas, or add #tags to categorize</div>
</div>
</div>

<div class="input-area">
  <div id="errorBanner" style="display:none"></div>
  <div class="input-container" id="inputContainer">
    <textarea id="inputBox" rows="1" placeholder="Capture a thought... (#tag to categorize)"></textarea>
    <div class="input-actions">
      <label class="task-toggle" id="taskToggleLabel" title="Add the next item as a task">
        <vscode-checkbox id="taskToggle" aria-label="Add the next item as a task">Add as task</vscode-checkbox>
      </label>
      <button class="send-icon-btn" id="sendBtn" title="Send (Enter)">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14.5 1.5l-14 5v1.5l5 1.5 8.5-8-6.5 9.5v3.5l2.5-3 3.5 2h1.5l2-15h-1.5z"/></svg>
      </button>
    </div>
  </div>
  <div class="hint" id="hintText">Enter to send · Shift+Enter for newline</div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let isTaskMode = false;
  let sendOnEnter = true;
  let isComposing = false; // IME composition guard

  const inputBox = document.getElementById('inputBox');
  const sendBtn = document.getElementById('sendBtn');
  const taskToggle = document.getElementById('taskToggle');
  const taskToggleLabel = document.getElementById('taskToggleLabel');
  const timeline = document.getElementById('timeline');
  const emptyState = document.getElementById('emptyState');
  const inboxBtn = document.getElementById('inboxBtn');
  const openTasksBtn = document.getElementById('openTasksBtn');
  const allBtn = document.getElementById('allBtn');
  const activeTagBtn = document.getElementById('activeTagBtn');
  const openFileBtn = document.getElementById('openFileBtn');
  const hintText = document.getElementById('hintText');
  const errorBanner = document.getElementById('errorBanner');
  let activeFilter = 'all';
  let activeTag = null;
  let activeTagLabel = '';
  let latestSections = [];
  let editingEntryKey = null;
  let editingText = '';
  let pendingScrollMode = 'top';
  const momentTagPattern = ${JSON.stringify(MOMENT_TAG_PATTERN)};

  // Notify extension we're ready
  vscode.postMessage({ command: 'ready' });

  // ---- Message from extension ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      sendOnEnter = msg.sendOnEnter;
      latestSections = msg.sections;
      if (
        editingEntryKey !== null
        && !latestSections.some((section) => section.entries.some((entry) => (section.date + ':' + entry.index) === editingEntryKey))
      ) {
        editingEntryKey = null;
        editingText = '';
      }
      updateHint();
      renderTimeline(latestSections);
      if (pendingScrollMode === 'top') {
        timeline.scrollTop = 0;
      }
      pendingScrollMode = null;
    } else if (msg.command === 'error') {
      showError(msg.message);
    }
  });

  function updateHint() {
    if (sendOnEnter) {
      hintText.textContent = 'Enter to send · Shift+Enter for newline';
    } else {
      hintText.textContent = 'Cmd+Enter / Ctrl+Enter to send';
    }
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
    setTimeout(() => { errorBanner.style.display = 'none'; }, 4000);
  }

  // ---- Render ----
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderText(text) {
    // Highlight #tags
    let html = escapeHtml(text);
    html = html.replace(new RegExp(momentTagPattern, 'gu'), (tag) => '<button class="tag" type="button" data-tag="' + tag + '">' + tag + '</button>');
    // Auto-link URLs
    html = html.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" style="color:var(--vscode-textLink-foreground)">$1</a>');
    return html;
  }

  function matchMomentTags(text) {
    return text.match(new RegExp(momentTagPattern, 'gu')) || [];
  }

  function normalizeTag(tag) {
    return String(tag || '').normalize('NFKC').toLowerCase();
  }

  function getEntryTags(entry) {
    if (Array.isArray(entry.tags) && entry.tags.length > 0) {
      return entry.tags.map((tag) => normalizeTag(tag));
    }

    return matchMomentTags(entry.text).map((tag) => normalizeTag(tag));
  }

  function setActiveTag(tag) {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag || activeTag === normalizedTag) {
      activeTag = null;
      activeTagLabel = '';
    } else {
      activeTag = normalizedTag;
      activeTagLabel = tag;
    }

    timeline.scrollTop = 0;
    renderTimeline(latestSections);
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  }

  function renderTimeline(sections) {
    const visibleSections = sections
      .map((section) => ({
        ...section,
        entries: section.entries
          .filter((entry) => activeFilter !== 'openTasks' || (entry.isTask && !entry.done))
          .filter((entry) => !activeTag || getEntryTags(entry).includes(activeTag))
          .slice()
          .reverse(),
      }))
      .filter((section) => section.entries.length > 0);

    allBtn.classList.toggle('active', activeFilter !== 'openTasks');
    allBtn.setAttribute('aria-pressed', String(activeFilter !== 'openTasks'));
    openTasksBtn.classList.toggle('active', activeFilter === 'openTasks');
    openTasksBtn.setAttribute('aria-pressed', String(activeFilter === 'openTasks'));
    activeTagBtn.style.display = activeTag ? '' : 'none';
    activeTagBtn.textContent = activeTag ? activeTagLabel + ' ×' : '';

    if (visibleSections.length === 0) {
      emptyState.style.display = 'block';
      timeline.querySelectorAll('.day-section').forEach(e => e.remove());
      if (activeTag && activeFilter === 'openTasks') {
        emptyState.textContent = 'No open tasks tagged ' + activeTagLabel + ' in this recent feed';
      } else if (activeTag) {
        emptyState.textContent = 'No moments tagged ' + activeTagLabel + ' in this recent feed';
      } else if (activeFilter === 'openTasks') {
        emptyState.textContent = 'No open tasks in this recent feed';
      } else {
        emptyState.textContent = 'No moments yet — capture your first thought!';
      }
      return;
    }

    emptyState.style.display = 'none';

    timeline.querySelectorAll('.day-section').forEach(e => e.remove());

    visibleSections.forEach((section) => {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'day-section';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'day-section-header';

      const sectionLabel = document.createElement('span');
      sectionLabel.className = 'day-section-label' + (section.isToday ? ' is-today' : '');
      sectionLabel.textContent = section.dateLabel;

      sectionHeader.appendChild(sectionLabel);
      sectionEl.appendChild(sectionHeader);

      section.entries.forEach((entry) => {
      const entryKey = section.date + ':' + entry.index;
      const div = document.createElement('div');
      div.className = 'entry' + (entry.isTask ? ' is-task' : '') + (entry.done ? ' task-done' : '');

      const meta = document.createElement('div');
      meta.className = 'entry-meta';

      const timeBadge = document.createElement('span');
      timeBadge.className = 'entry-time';
      timeBadge.textContent = entry.time;

      meta.appendChild(timeBadge);

      if (editingEntryKey === entryKey) {
        const editWrap = document.createElement('div');
        editWrap.className = 'entry-edit';

        const editInput = document.createElement('textarea');
        editInput.value = editingText;
        editInput.setAttribute('aria-label', 'Edit Moment entry');
        editInput.addEventListener('input', () => {
          editingText = editInput.value;
          autoResizeTextarea(editInput);
        });
        editInput.addEventListener('keydown', (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            const nextText = editInput.value.trim();
            if (!nextText) {
              showError('Moment text cannot be empty.');
              return;
            }
            editingEntryKey = null;
            editingText = '';
            vscode.postMessage({ command: 'saveEdit', date: section.date, index: entry.index, text: nextText });
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            editingEntryKey = null;
            editingText = '';
            renderTimeline(latestSections);
          }
        });

        const editActions = document.createElement('div');
        editActions.className = 'entry-edit-actions';

        const saveButton = document.createElement('button');
        saveButton.className = 'entry-action save';
        saveButton.type = 'button';
        saveButton.title = 'Save';
        saveButton.innerHTML = '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.43 3.43l-8 8-4.22-4.22.71-.71 3.51 3.51 7.29-7.29.71.71z"/></svg>';
        saveButton.addEventListener('click', () => {
          const nextText = editInput.value.trim();
          if (!nextText) {
            showError('Moment text cannot be empty.');
            return;
          }
          editingEntryKey = null;
          editingText = '';
          vscode.postMessage({ command: 'saveEdit', date: section.date, index: entry.index, text: nextText });
        });

        const cancelButton = document.createElement('button');
        cancelButton.className = 'entry-action';
        cancelButton.type = 'button';
        cancelButton.title = 'Cancel';
        cancelButton.innerHTML = '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.7 8l3.15-3.15-.7-.7L8 7.3 4.85 4.15l-.7.7L7.3 8l-3.15 3.15.7.7L8 8.7l3.15 3.15.7-.7L8.7 8z"/></svg>';
        cancelButton.addEventListener('click', () => {
          editingEntryKey = null;
          editingText = '';
          renderTimeline(latestSections);
        });

        editActions.appendChild(saveButton);
        editActions.appendChild(cancelButton);
        editWrap.appendChild(editInput);
        editWrap.appendChild(editActions);
        div.appendChild(editWrap);

        sectionEl.appendChild(div);
        setTimeout(() => {
          editInput.focus();
          editInput.selectionStart = editInput.value.length;
          editInput.selectionEnd = editInput.value.length;
          autoResizeTextarea(editInput);
        }, 0);
        return;
      }

      const textSpan = document.createElement('div');
      textSpan.className = 'entry-text';
      textSpan.innerHTML = renderText(entry.text);
      textSpan.querySelectorAll('.tag').forEach((tagButton) => {
        tagButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setActiveTag(tagButton.dataset.tag || '');
        });
      });

      const content = document.createElement('div');
      content.className = 'entry-content';
      content.appendChild(meta);
      content.appendChild(textSpan);

      const main = document.createElement('div');
      main.className = 'entry-main';

      const body = document.createElement('div');
      body.className = 'entry-body';

      const bodyContent = document.createElement('div');
      bodyContent.className = 'entry-body-content';

      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'entry-icon-wrapper';

      if (entry.isTask) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'entry-checkbox';
        checkbox.checked = entry.done;
        checkbox.title = entry.done ? 'Mark task as open' : 'Mark task as done';
        checkbox.setAttribute('aria-label', entry.done ? 'Mark task as open' : 'Mark task as done');
        checkbox.addEventListener('change', () => {
          vscode.postMessage({ command: 'toggleTask', date: section.date, index: entry.index });
        });
        iconWrapper.appendChild(checkbox);
      }
      
      body.appendChild(iconWrapper);

      main.appendChild(content);

      const actions = document.createElement('div');
      actions.className = 'entry-actions';

      const convertButton = document.createElement('button');
      convertButton.className = 'entry-action primary';
      convertButton.type = 'button';
      convertButton.title = entry.isTask ? 'Make Note' : 'Make Task';
      convertButton.innerHTML = entry.isTask 
        ? '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM10 2.41l2.59 2.59H10V2.41zM13 14H4V2h5v4h4v8z"/></svg>'
        : '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M14 3v10H2V3h12zm-1-1H3L2 3v10l1 1h10l1-1V3l-1-1zm-2.07 4.21l-3.3 3.3a.5.5 0 01-.7 0L5.35 7.93l.7-.71 1.18 1.18 2.95-2.95.75.76z"/></svg>';
      convertButton.addEventListener('click', () => {
        vscode.postMessage({
          command: entry.isTask ? 'convertToNote' : 'convertToTask',
          date: section.date,
          index: entry.index,
        });
      });
      actions.appendChild(convertButton);

      const editButton = document.createElement('button');
      editButton.className = 'entry-action';
      editButton.type = 'button';
      editButton.title = 'Edit';
      editButton.innerHTML = '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.8 2.2l-1-1c-.5-.5-1.3-.5-1.8 0l-8 8v2.8l1 1h2.8l8-8c.5-.5.5-1.3 0-1.8zm-1.8.7l1 1-1.3 1.3-1-1 1.3-1.3zm-2.3 2.3l1 1-6.8 6.8H3v-1l6.7-6.8z"/></svg>';
      editButton.addEventListener('click', () => {
        editingEntryKey = entryKey;
        editingText = entry.text;
        renderTimeline(latestSections);
      });

      const deleteButton = document.createElement('button');
      deleteButton.className = 'entry-action danger';
      deleteButton.type = 'button';
      deleteButton.title = 'Delete';
      deleteButton.innerHTML = '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 011-1h3a1 1 0 011 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9z"/><path d="M6 6h1v5H6zM8 6h1v5H8z"/></svg>';
      deleteButton.addEventListener('click', () => {
        if (editingEntryKey === entryKey) {
          editingEntryKey = null;
          editingText = '';
        }
        vscode.postMessage({ command: 'requestDeleteEntry', date: section.date, index: entry.index });
      });

      actions.appendChild(editButton);
      actions.appendChild(deleteButton);
      bodyContent.appendChild(main);
      bodyContent.appendChild(actions);
      body.appendChild(bodyContent);
      div.appendChild(body);
      sectionEl.appendChild(div);
    });

      timeline.appendChild(sectionEl);
    });
  }

  // ---- Input ----
  taskToggle.addEventListener('change', () => {
    isTaskMode = taskToggle.checked;
    taskToggleLabel.classList.toggle('active', isTaskMode);
  });

  function send() {
    const text = inputBox.value.trim();
    if (!text) return;
    pendingScrollMode = 'top';
    vscode.postMessage({ command: 'addMoment', text, isTask: isTaskMode });
    inputBox.value = '';
    autoResize();
  }

  sendBtn.addEventListener('click', send);

  // Track IME composition to prevent sending on Japanese/CJK Enter confirmation
  inputBox.addEventListener('compositionstart', () => { isComposing = true; });
  inputBox.addEventListener('compositionend', () => { isComposing = false; });

  inputBox.addEventListener('keydown', (e) => {
    if (isComposing) { return; } // ignore Enter during IME composition
    if (sendOnEnter) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    } else {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send();
      }
    }
  });

  inputBox.addEventListener('input', autoResize);

  function autoResize() {
    autoResizeTextarea(inputBox);
  }

  openFileBtn.addEventListener('click', () => vscode.postMessage({ command: 'openFile' }));
  inboxBtn.addEventListener('click', () => vscode.postMessage({ command: 'showOpenTasksOverview' }));
  allBtn.addEventListener('click', () => {
    if (activeFilter !== 'all') {
      activeFilter = 'all';
      renderTimeline(latestSections);
    }
  });
  openTasksBtn.addEventListener('click', () => {
    if (activeFilter !== 'openTasks') {
      activeFilter = 'openTasks';
      renderTimeline(latestSections);
    }
  });
  activeTagBtn.addEventListener('click', () => {
    activeTag = null;
    activeTagLabel = '';
    renderTimeline(latestSections);
  });
</script>
</body>
</html>`;
  }
}
