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

let lastInboxTaskFilter: InboxTaskFilter = "all";

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
      entries.push({ index: i, time: taskDone[1], text: taskDone[2], isTask: true, done: true });
    } else if (taskTodo) {
      entries.push({ index: i, time: taskTodo[1], text: taskTodo[2], isTask: true, done: false });
    } else if (regular) {
      entries.push({ index: i, time: regular[1], text: regular[2], isTask: false, done: false });
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
  private _currentDate: string = formatDate(new Date());
  private readonly _getNotesDir: () => string | undefined;

  constructor(getNotesDir: () => string | undefined) {
    this._getNotesDir = getNotesDir;
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
          appendMoment(notesDir, this._currentDate, message.text, message.isTask ?? false);
          this._sendEntries();
          break;
        }

        case "toggleTask": {
          if (!notesDir) {
            return;
          }
          toggleTask(notesDir, message.date ?? this._currentDate, message.index);
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
              message.date ?? this._currentDate,
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

              if (!deleteMomentEntry(notesDir, message.date ?? this._currentDate, message.index)) {
                this._showError("Could not delete that Moment entry.");
                return;
              }

              this._sendEntries();
            });
          break;
        }

        case "navigate": {
          this._currentDate = offsetDate(this._currentDate, message.delta);
          this._sendEntries();
          break;
        }

        case "goToday": {
          this._currentDate = formatDate(new Date());
          this._sendEntries();
          break;
        }

        case "openFile": {
          if (!notesDir) {
            return;
          }
          const filePath = getMomentsFilePath(notesDir, this._currentDate);
          if (!fs.existsSync(filePath)) {
            ensureMomentsFile(notesDir, this._currentDate);
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
    const sections = notesDir ? collectMomentsFeed(notesDir, this._currentDate) : [];
    const today = formatDate(new Date());
    const sendOnEnter = getSendOnEnter();

    this._view.webview.postMessage({
      command: "update",
      sections,
      anchorDate: this._currentDate,
      anchorDateLabel: buildMomentsDateLabel(this._currentDate, today),
      anchorIsToday: this._currentDate === today,
      sendOnEnter,
    });
  }

  private _showError(msg: string): void {
    this._view?.webview.postMessage({ command: "error", message: msg });
  }

  private _getHtml(_webview: vscode.Webview): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Moments</title>
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

  .topbar-row-main {
    justify-content: space-between;
  }

  .topbar-row-actions {
    flex-wrap: wrap;
    justify-content: center;
  }

  .nav-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 13px;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s;
  }
  .nav-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

  .nav-btn.active {
    opacity: 1;
    color: var(--vscode-textLink-foreground);
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
  }

  .date-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
    flex: 1;
    text-align: center;
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .date-label.is-today { color: var(--vscode-textLink-foreground); }

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

  .entry-header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 18px;
  }

  .entry-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .entry-kind {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 1px 6px;
    background: color-mix(in srgb, var(--vscode-descriptionForeground) 12%, transparent);
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    font-weight: 600;
  }

  .entry-kind.is-task {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 16%, transparent);
    color: var(--vscode-textLink-foreground);
  }

  .entry-kind.is-done {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
    color: var(--vscode-textLink-foreground);
  }

  .entry-time {
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
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
    gap: 10px;
    flex-wrap: wrap;
  }

  .entry-action {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 2px 0;
    font-size: 11px;
    opacity: 0.9;
    transition: color 0.15s, opacity 0.15s;
  }

  .entry-action:hover {
    color: var(--vscode-foreground);
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
    padding: 0 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
    color: var(--vscode-textLink-foreground);
    font-size: 11px;
    font-weight: 500;
    margin: 0 1px;
    text-decoration: none;
  }

  /* ---- Input area ---- */
  .input-area {
    flex-shrink: 0;
    padding: 8px 6px 6px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }

  textarea {
    display: block;
    width: 100%;
    resize: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 5px;
    padding: 6px 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.4;
    outline: none;
    min-height: 36px;
    max-height: 120px;
    overflow-y: auto;
    margin-bottom: 5px;
  }
  textarea:focus {
    border-color: var(--vscode-focusBorder);
  }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

  /* Bottom row: task toggle (left) + send button (right) */
  .input-actions {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .send-btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 5px;
    padding: 5px 14px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
    white-space: nowrap;
    margin-left: auto;
  }
  .send-btn:hover { background: var(--vscode-button-hoverBackground); }

  .task-toggle {
    background: none;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    color: var(--vscode-foreground);
    border-radius: 5px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 11px;
    opacity: 0.6;
    transition: opacity 0.15s, background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .task-toggle.active {
    opacity: 1;
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
    border-color: var(--vscode-input-border, var(--vscode-panel-border));
    color: var(--vscode-textLink-foreground);
  }
  .task-toggle:hover { opacity: 1; }

  .hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.5;
    margin-top: 4px;
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
  <div class="topbar-row topbar-row-main">
    <button class="nav-btn" id="prevBtn" title="Previous day">&#8249;</button>
    <span class="date-label" id="dateLabel">—</span>
    <button class="nav-btn" id="nextBtn" title="Next day">&#8250;</button>
    <button class="open-btn" id="openFileBtn" title="Open file in editor">&#8599;</button>
  </div>
  <div class="topbar-row topbar-row-actions">
    <button class="nav-btn" id="inboxBtn" title="Show open tasks across all days">Inbox</button>
    <button class="nav-btn" id="openTasksBtn" title="Show open tasks only">Open</button>
    <button class="nav-btn" id="todayBtn" title="Go to today">Today</button>
  </div>
</div>

<div class="timeline" id="timeline">
  <div class="empty-state" id="emptyState">No moments yet today</div>
</div>

<div class="input-area">
  <div id="errorBanner" style="display:none"></div>
  <textarea id="inputBox" rows="1" placeholder="Capture a thought…"></textarea>
  <div class="input-actions">
    <button class="task-toggle" id="taskToggle" title="Toggle task mode" aria-pressed="false">Task</button>
    <button class="send-btn" id="sendBtn">Send &#10148;</button>
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
  const timeline = document.getElementById('timeline');
  const emptyState = document.getElementById('emptyState');
  const dateLabel = document.getElementById('dateLabel');
  const inboxBtn = document.getElementById('inboxBtn');
  const openTasksBtn = document.getElementById('openTasksBtn');
  const todayBtn = document.getElementById('todayBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const openFileBtn = document.getElementById('openFileBtn');
  const hintText = document.getElementById('hintText');
  const errorBanner = document.getElementById('errorBanner');
  let activeFilter = 'all';
  let latestSections = [];
  let latestAnchorDate = '';
  let latestAnchorDateLabel = '';
  let latestAnchorIsToday = true;
  let editingEntryKey = null;
  let editingText = '';
  let pendingScrollMode = 'top';

  // Notify extension we're ready
  vscode.postMessage({ command: 'ready' });

  // ---- Message from extension ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      sendOnEnter = msg.sendOnEnter;
      if (latestAnchorDate && latestAnchorDate !== msg.anchorDate) {
        editingEntryKey = null;
        editingText = '';
      }
      latestSections = msg.sections;
      latestAnchorDate = msg.anchorDate;
      latestAnchorDateLabel = msg.anchorDateLabel;
      latestAnchorIsToday = msg.anchorIsToday;
      if (
        editingEntryKey !== null
        && !latestSections.some((section) => section.entries.some((entry) => (section.date + ':' + entry.index) === editingEntryKey))
      ) {
        editingEntryKey = null;
        editingText = '';
      }
      updateHint();
      renderTimeline(latestSections, latestAnchorDate, latestAnchorIsToday, latestAnchorDateLabel);
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
    html = html.replace(/(#[\\w-]+)/g, '<span class="tag">$1</span>');
    // Auto-link URLs
    html = html.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" style="color:var(--vscode-textLink-foreground)">$1</a>');
    return html;
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  }

  function renderTimeline(sections, anchorDate, anchorIsToday, anchorDateLabelText) {
    const visibleSections = sections
      .map((section) => ({
        ...section,
        entries: (activeFilter === 'openTasks'
          ? section.entries.filter((entry) => entry.isTask && !entry.done)
          : section.entries
        ).slice().reverse(),
      }))
      .filter((section) => section.entries.length > 0);

    dateLabel.textContent = anchorDateLabelText || anchorDate;
    dateLabel.className = 'date-label' + (anchorIsToday ? ' is-today' : '');
    openTasksBtn.classList.toggle('active', activeFilter === 'openTasks');
    openTasksBtn.setAttribute('aria-pressed', String(activeFilter === 'openTasks'));

    todayBtn.style.display = anchorIsToday ? 'none' : '';

    if (visibleSections.length === 0) {
      emptyState.style.display = 'block';
      timeline.querySelectorAll('.day-section').forEach(e => e.remove());
      if (activeFilter === 'openTasks') {
        emptyState.textContent = 'No open tasks in this feed';
      } else {
        emptyState.textContent = anchorIsToday ? 'No moments yet — capture your first thought!' : 'No moments in this feed window';
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

      const header = document.createElement('div');
      header.className = 'entry-header';

      const meta = document.createElement('div');
      meta.className = 'entry-meta';

      const kind = document.createElement('span');
      kind.className = 'entry-kind' + (entry.isTask ? ' is-task' : '') + (entry.done ? ' is-done' : '');
      kind.textContent = entry.isTask ? (entry.done ? 'Task · Done' : 'Task') : 'Moment';

      const timeBadge = document.createElement('span');
      timeBadge.className = 'entry-time';
      timeBadge.textContent = entry.time;

      meta.appendChild(kind);
      meta.appendChild(timeBadge);
      header.appendChild(meta);
      div.appendChild(header);

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
            renderTimeline(latestSections, latestAnchorDate, latestAnchorIsToday, latestAnchorDateLabel);
          }
        });

        const editActions = document.createElement('div');
        editActions.className = 'entry-edit-actions';

        const saveButton = document.createElement('button');
        saveButton.className = 'entry-action save';
        saveButton.type = 'button';
        saveButton.textContent = 'Save';
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
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => {
          editingEntryKey = null;
          editingText = '';
          renderTimeline(latestSections, latestAnchorDate, latestAnchorIsToday, latestAnchorDateLabel);
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

      const actions = document.createElement('div');
      actions.className = 'entry-actions';

      if (entry.isTask) {
        const toggleButton = document.createElement('button');
        toggleButton.className = 'entry-action primary';
        toggleButton.type = 'button';
        toggleButton.textContent = entry.done ? 'Mark Open' : 'Mark Done';
        toggleButton.addEventListener('click', () => {
          vscode.postMessage({ command: 'toggleTask', date: section.date, index: entry.index });
        });
        actions.appendChild(toggleButton);
      }

      const editButton = document.createElement('button');
      editButton.className = 'entry-action';
      editButton.type = 'button';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => {
        editingEntryKey = entryKey;
        editingText = entry.text;
        renderTimeline(latestSections, latestAnchorDate, latestAnchorIsToday, latestAnchorDateLabel);
      });

      const deleteButton = document.createElement('button');
      deleteButton.className = 'entry-action danger';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => {
        if (editingEntryKey === entryKey) {
          editingEntryKey = null;
          editingText = '';
        }
        vscode.postMessage({ command: 'requestDeleteEntry', date: section.date, index: entry.index });
      });

      actions.appendChild(editButton);
      actions.appendChild(deleteButton);
      div.appendChild(textSpan);
      div.appendChild(actions);
      sectionEl.appendChild(div);
    });

      timeline.appendChild(sectionEl);
    });
  }

  // ---- Input ----
  taskToggle.addEventListener('click', () => {
    isTaskMode = !isTaskMode;
    taskToggle.classList.toggle('active', isTaskMode);
    taskToggle.setAttribute('aria-pressed', String(isTaskMode));
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

  // ---- Navigation ----
  prevBtn.addEventListener('click', () => {
    pendingScrollMode = 'top';
    vscode.postMessage({ command: 'navigate', delta: -1 });
  });
  nextBtn.addEventListener('click', () => {
    pendingScrollMode = 'top';
    vscode.postMessage({ command: 'navigate', delta: 1 });
  });
  todayBtn.addEventListener('click', () => {
    pendingScrollMode = 'top';
    vscode.postMessage({ command: 'goToday' });
  });
  openFileBtn.addEventListener('click', () => vscode.postMessage({ command: 'openFile' }));
  inboxBtn.addEventListener('click', () => vscode.postMessage({ command: 'showOpenTasksOverview' }));
  openTasksBtn.addEventListener('click', () => {
    activeFilter = activeFilter === 'openTasks' ? 'all' : 'openTasks';
    renderTimeline(latestSections, latestAnchorDate, latestAnchorIsToday, latestAnchorDateLabel);
  });
</script>
</body>
</html>`;
  }
}
