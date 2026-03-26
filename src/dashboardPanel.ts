import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { extractTasksFromMoments, planDay } from "./aiTaskProcessor.js";

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
  label: string; // "Mon", "Tue", ...
  open: number;
  done: number;
}

// ---------------------------------------------------------------------------
// File-based task collection (VS Code extension can't use bun:sqlite)
// ---------------------------------------------------------------------------

const TASK_RE = /^- \[([ xX])\] (.+)$/;
const TAG_RE = /#[\w\u3040-\u9FFF\u4E00-\u9FFF-]+/g;
const DUE_DATE_RE = /(?:📅|due:|@)(\d{4}-\d{2}-\d{2})/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateFromFilePath(filePath: string): string | null {
  const m = path.basename(filePath, ".md").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function collectTasksFromNotes(notesDir: string, momentsSubfolder = "moments"): DashTask[] {
  const tasks: DashTask[] = [];
  const momentsAbsPath = path.resolve(notesDir, momentsSubfolder);

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) === momentsAbsPath) continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
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
          const m = TASK_RE.exec(lines[i]);
          if (!m) continue;
          const done = m[1].toLowerCase() === "x";
          const text = m[2].trim();
          const tags = [...new Set(text.match(TAG_RE) ?? [])];
          const dueDateMatch = DUE_DATE_RE.exec(text);
          tasks.push({
            id: `${relPath}:${i}`,
            filePath: fullPath,
            lineIndex: i,
            text,
            done,
            date,
            dueDate: dueDateMatch ? dueDateMatch[1] : null,
            tags,
          });
        }
      }
    }
  }

  walk(notesDir);
  return tasks;
}

function last7Days(): WeekDay[] {
  const days: WeekDay[] = [];
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    days.push({ date: dateStr, label: dayLabels[d.getDay()], open: 0, done: 0 });
  }
  return days;
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
  private _disposables: vscode.Disposable[] = [];
  private _cancelToken: vscode.CancellationTokenSource | undefined;

  static createOrShow(getNotesDir: () => string | undefined, extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel._instance) {
      DashboardPanel._instance._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      "AI Task Dashboard",
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    DashboardPanel._instance = new DashboardPanel(panel, getNotesDir, extensionUri);
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

  static runPlanDay(): void {
    if (DashboardPanel._instance) {
      void DashboardPanel._instance._runPlanDay();
    }
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
  ) {
    this._panel = panel;
    this._getNotesDir = getNotesDir;

    this._panel.webview.options = { enableScripts: true };
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: unknown) => this._handleMessage(message as Record<string, unknown>),
      null,
      this._disposables,
    );

    this._update();
  }

  private dispose(): void {
    DashboardPanel._instance = undefined;
    this._panel.dispose();
    this._cancelToken?.cancel();
    for (const d of this._disposables) d.dispose();
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
    const week = last7Days();

    for (const task of tasks) {
      const day = week.find((d) => d.date === task.date);
      if (day) {
        if (task.done) day.done++;
        else day.open++;
      }
    }

    const openTasks = tasks.filter((t) => !t.done);

    // Compute the cutoff date string (today + 7 days, YYYY-MM-DD)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + 7);
    const cutoffStr = `${cutoffDate.getFullYear()}-${pad2(cutoffDate.getMonth() + 1)}-${pad2(cutoffDate.getDate())}`;

    const upcomingTasks = tasks
      .filter((t) => {
        if (t.date === today || t.date === null) return true;
        if (t.dueDate && t.dueDate <= cutoffStr) return true;
        return false;
      })
      .sort((a, b) => {
        // Open tasks come before done tasks
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.done) {
          // Both open: tasks with due dates first (ascending), then undated alphabetically
          const aDue = a.dueDate ?? null;
          const bDue = b.dueDate ?? null;
          if (aDue && bDue) return aDue.localeCompare(bDue);
          if (aDue) return -1;
          if (bDue) return 1;
          return a.text.localeCompare(b.text);
        }
        // Both done: alphabetical
        return a.text.localeCompare(b.text);
      });

    const CATEGORIES = ["work", "personal", "health", "learning", "admin"];
    const catCount: Record<string, number> = {};
    for (const cat of [...CATEGORIES, "other"]) catCount[cat] = 0;
    for (const t of openTasks) {
      let matched = false;
      for (const tag of t.tags) {
        const c = tag.replace("#", "").toLowerCase();
        if (CATEGORIES.includes(c)) {
          catCount[c]++;
          matched = true;
          break;
        }
      }
      if (!matched) catCount["other"]++;
    }

    const totalDone = tasks.filter((t) => t.done).length;
    const totalAll = tasks.length;
    const completionRate = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

    const data = {
      today,
      upcomingTasks,
      week,
      catCount,
      totalOpen: openTasks.length,
      totalDone,
      completionRate,
    };

    this._panel.webview.html = this._getHtml(data);
  }

  private _handleMessage(message: Record<string, unknown>): void {
    switch (message.command) {
      case "refresh":
        this._update();
        break;

      case "toggleTask": {
        const { taskId, done } = message as { command: string; taskId: string; done: boolean };
        this._toggleTask(taskId, done);
        break;
      }

      case "openFile": {
        const { filePath, lineIndex } = message as {
          command: string;
          filePath: string;
          lineIndex: number;
        };
        void this._openFile(filePath, lineIndex);
        break;
      }

      case "planDay": {
        void this._runPlanDay();
        break;
      }

      case "aiExtract": {
        void this._runAiExtract();
        break;
      }

      case "addExtractedTask": {
        const { text, dueDate } = message as {
          command: string;
          text: string;
          dueDate?: string | null;
        };
        void this._addExtractedTask(text, dueDate);
        break;
      }
    }
  }

  private _toggleTask(taskId: string, done: boolean): void {
    const notesDir = this._getNotesDir();
    if (!notesDir) return;

    // taskId format: "relPath:lineIndex"
    const colonIdx = taskId.lastIndexOf(":");
    if (colonIdx < 0) return;
    const relPath = taskId.slice(0, colonIdx);
    const lineIndex = parseInt(taskId.slice(colonIdx + 1), 10);
    if (isNaN(lineIndex)) return;

    // Validate path to prevent traversal
    const absPath = path.resolve(notesDir, relPath);
    if (
      !absPath.startsWith(path.resolve(notesDir) + path.sep) &&
      absPath !== path.resolve(notesDir)
    )
      return;

    if (!fs.existsSync(absPath)) return;

    const lines = fs.readFileSync(absPath, "utf8").split("\n");
    const line = lines[lineIndex];
    if (!line) return;

    lines[lineIndex] = done
      ? line.replace(/^- \[ \]/, "- [x]")
      : line.replace(/^- \[[xX]\]/, "- [ ]");

    fs.writeFileSync(absPath, lines.join("\n"), "utf8");
    this._update();
  }

  private async _openFile(filePath: string, lineIndex: number): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    const pos = new vscode.Position(lineIndex, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
  }

  private async _runPlanDay(): Promise<void> {
    this._cancelToken?.cancel();
    this._cancelToken = new vscode.CancellationTokenSource();
    const token = this._cancelToken.token;

    DashboardPanel._statusListener?.(true);
    this._panel.webview.postMessage({
      type: "aiStatus",
      status: "processing",
      message: "AIがタスクを優先順位付け中...",
    });

    try {
      const notesDir = this._getNotesDir();
      if (!notesDir) return;

      const momentsSubfolder =
        vscode.workspace.getConfiguration("notes").get<string>("momentsSubfolder") || "moments";
      const tasks = collectTasksFromNotes(notesDir, momentsSubfolder);
      const today = todayDateString();
      const todayOpen = tasks.filter((t) => !t.done && (t.date === today || t.date === null));

      const result = await planDay(today, todayOpen, token);
      if (!result) {
        this._panel.webview.postMessage({
          type: "aiStatus",
          status: "error",
          message: "AI が利用できません。GitHub Copilot が有効か確認してください。",
        });
        return;
      }
      this._panel.webview.postMessage({ type: "planDayResult", plan: result });
    } finally {
      DashboardPanel._statusListener?.(false);
    }
  }

  private async _runAiExtract(): Promise<void> {
    this._cancelToken?.cancel();
    this._cancelToken = new vscode.CancellationTokenSource();
    const token = this._cancelToken.token;

    DashboardPanel._statusListener?.(true);
    this._panel.webview.postMessage({
      type: "aiStatus",
      status: "processing",
      message: "今日の Moments を AI が分析中...",
    });

    try {
      const notesDir = this._getNotesDir();
      if (!notesDir) return;

      const momentsSubfolder =
        vscode.workspace.getConfiguration("notes").get<string>("momentsSubfolder") || "moments";
      const today = todayDateString();
      const momentsFile = path.join(notesDir, momentsSubfolder, `${today}.md`);

      if (!fs.existsSync(momentsFile)) {
        this._panel.webview.postMessage({
          type: "aiStatus",
          status: "error",
          message: "今日の Moments ファイルが見つかりません。",
        });
        return;
      }

      const content = fs.readFileSync(momentsFile, "utf8");
      // Strip front matter
      const body = content.replace(/^---[\s\S]*?---\s*/m, "").trim();
      // Strip timestamp prefixes to get clean text
      const cleanText = body
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.replace(/^- (\d{2}:\d{2} )?/, "").trim())
        .join("\n");

      if (!cleanText) {
        this._panel.webview.postMessage({
          type: "aiStatus",
          status: "error",
          message: "今日の Moments にテキストが見つかりません。",
        });
        return;
      }

      const extracted = await extractTasksFromMoments(cleanText, token);
      if (extracted.length === 0) {
        this._panel.webview.postMessage({
          type: "aiStatus",
          status: "done",
          message: "実行可能なタスクは見つかりませんでした。",
        });
        return;
      }
      this._panel.webview.postMessage({ type: "extractResult", tasks: extracted });
    } finally {
      DashboardPanel._statusListener?.(false);
    }
  }

  private async _addExtractedTask(text: string, dueDate?: string | null): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) return;

    const today = todayDateString();
    const taskDir = path.join(notesDir, "tasks");
    fs.mkdirSync(taskDir, { recursive: true });
    const taskFile = path.join(taskDir, `${today}.md`);
    if (!fs.existsSync(taskFile)) {
      fs.writeFileSync(taskFile, `---\ntype: tasks\ndate: ${today}\n---\n\n`, "utf8");
    }
    const existing = fs.readFileSync(taskFile, "utf8");
    const sep = existing.endsWith("\n") ? "" : "\n";
    const dueSuffix = dueDate ? ` @${dueDate}` : "";
    fs.writeFileSync(taskFile, `${existing}${sep}- [ ] ${text}${dueSuffix}\n`, "utf8");

    vscode.window.showInformationMessage(`タスクを追加しました: ${text}`);
    this._update();
  }

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  private _getLoadingHtml(message: string): string {
    return `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)"><p>${message}</p></body></html>`;
  }

  private _getHtml(data: {
    today: string;
    upcomingTasks: DashTask[];
    week: WeekDay[];
    catCount: Record<string, number>;
    totalOpen: number;
    totalDone: number;
    completionRate: number;
  }): string {
    const nonce = crypto.randomBytes(16).toString("hex");

    const weekMax = Math.max(...data.week.map((d) => d.open + d.done), 1);

    const todayTasksHtml =
      data.upcomingTasks.length === 0
        ? `<p class="empty">今日のタスクはありません 🎉</p>`
        : data.upcomingTasks
            .map((t) => {
              const doneClass = t.done ? " done" : "";
              const safeTxt = escHtml(t.text);
              const safeId = escAttr(t.id);
              const safePath = escAttr(t.filePath);
              const dueBadge = t.dueDate
                ? ` <span class="due-badge">${escHtml(t.dueDate)}</span>`
                : "";
              return `<div class="task-item${doneClass}">
            <input type="checkbox" ${t.done ? "checked" : ""} data-task-id="${safeId}">
            <span class="task-text" data-file="${safePath}" data-line="${t.lineIndex}">${safeTxt}${dueBadge}</span>
          </div>`;
            })
            .join("");

    const weekBarsHtml = data.week
      .map((d) => {
        const total = d.open + d.done;
        const doneW = total > 0 ? Math.round((d.done / weekMax) * 100) : 0;
        const openW = total > 0 ? Math.round((d.open / weekMax) * 100) : 0;
        const isToday = d.date === data.today;
        return `<div class="week-day${isToday ? " today" : ""}">
        <div class="week-label">${escHtml(d.label)}</div>
        <div class="week-bar">
          <div class="bar-done" style="width:${doneW}%"></div>
          <div class="bar-open" style="width:${openW}%"></div>
        </div>
        <div class="week-count">${total}</div>
      </div>`;
      })
      .join("");

    const CATS = ["work", "personal", "health", "learning", "admin", "other"];
    const CAT_ICONS: Record<string, string> = {
      work: "💼",
      personal: "🏠",
      health: "🏃",
      learning: "📚",
      admin: "🗂",
      other: "📌",
    };
    const catMax = Math.max(...CATS.map((c) => data.catCount[c] ?? 0), 1);
    const catHtml = CATS.map((c) => {
      const n = data.catCount[c] ?? 0;
      const w = Math.round((n / catMax) * 100);
      return `<div class="cat-row">
        <div class="cat-label">${CAT_ICONS[c]} ${c}</div>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${w}%"></div></div>
        <div class="cat-count">${n}</div>
      </div>`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  :root { --radius: 10px; --gap: 10px; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: var(--gap);
  }

  /* ── Header ── */
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .header-title {
    font-size: 16px; font-weight: 700; flex: 1;
    background: linear-gradient(135deg, var(--vscode-textLink-foreground, #89b4fa), var(--vscode-badge-foreground, #cba6f7));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    letter-spacing: -0.3px;
  }
  .header-date {
    font-size: 10px; color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border, #313244);
    padding: 2px 8px; border-radius: 20px;
  }
  .btn {
    padding: 4px 10px; font-size: 11px; border-radius: 6px; cursor: pointer;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-panel-border, #313244);
    transition: border-color 0.15s;
  }
  .btn:hover { border-color: var(--vscode-textLink-foreground); color: var(--vscode-textLink-foreground); }
  .btn-primary {
    background: linear-gradient(135deg, var(--vscode-textLink-foreground, #89b4fa), var(--vscode-badge-foreground, #cba6f7));
    color: var(--vscode-editor-background, #1e1e2e);
    border: none; font-weight: 600;
  }
  .btn-primary:hover { opacity: 0.85; color: var(--vscode-editor-background, #1e1e2e); border-color: transparent; }

  /* ── KPI Stats Row ── */
  .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap); margin-bottom: var(--gap); }
  .stat-card {
    border-radius: var(--radius); padding: 12px 14px;
    display: flex; align-items: center; gap: 10px;
    border: 1px solid transparent;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  }
  .stat-card.open  { background: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 12%, var(--vscode-editor-background, #1e1e2e)); border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 30%, transparent); }
  .stat-card.done  { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 12%, var(--vscode-editor-background, #1e1e2e)); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 30%, transparent); }
  .stat-card.rate  { background: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 12%, var(--vscode-editor-background, #1e1e2e)); border-color: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 30%, transparent); }
  .stat-icon { font-size: 20px; flex-shrink: 0; }
  .stat-value { font-size: 22px; font-weight: 700; line-height: 1; margin-bottom: 2px; }
  .stat-card.open .stat-value { color: var(--vscode-textLink-foreground, #89b4fa); }
  .stat-card.done .stat-value { color: var(--vscode-testing-iconPassed, #a6e3a1); }
  .stat-card.rate .stat-value { color: var(--vscode-badge-foreground, #cba6f7); }
  .stat-label { font-size: 9px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }

  /* ── Grid ── */
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); margin-bottom: var(--gap); }
  @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } .stats-row { grid-template-columns: 1fr; } }

  /* ── Card ── */
  .card {
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border, #313244);
    border-radius: var(--radius); padding: 14px;
  }
  .card-title {
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
    color: var(--vscode-descriptionForeground); margin-bottom: 10px;
    display: flex; align-items: center; gap: 6px;
  }
  .card-title-badge {
    background: var(--vscode-badge-background, #313244);
    color: var(--vscode-textLink-foreground, #89b4fa);
    font-size: 9px; padding: 1px 6px; border-radius: 10px;
    margin-left: auto; letter-spacing: 0; text-transform: none; font-weight: 600;
  }

  /* ── Upcoming Tasks ── */
  .task-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border, #313244); }
  .task-item:last-child { border-bottom: none; }
  .task-check {
    width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0; margin-top: 1px;
    border: 1.5px solid var(--vscode-panel-border, #45475a);
    appearance: none; -webkit-appearance: none; cursor: pointer;
    background: transparent; position: relative;
    accent-color: var(--vscode-textLink-foreground);
    transition: border-color 0.15s;
  }
  .task-check:hover { border-color: var(--vscode-textLink-foreground); }
  .task-check:checked {
    background: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 20%, transparent);
    border-color: var(--vscode-testing-iconPassed, #a6e3a1);
  }
  .task-check:checked::after {
    content: '✓'; font-size: 9px; color: var(--vscode-testing-iconPassed, #a6e3a1);
    position: absolute; top: -1px; left: 1px;
  }
  .task-body { flex: 1; min-width: 0; }
  .task-text { font-size: 12px; line-height: 1.4; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .task-text:hover { color: var(--vscode-textLink-foreground); }
  .task-item.done .task-text { text-decoration: line-through; color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
  .task-meta { display: flex; gap: 4px; margin-top: 3px; flex-wrap: wrap; }
  .badge {
    font-size: 9px; padding: 1px 6px; border-radius: 10px;
    border: 1px solid transparent;
  }
  .badge-tag   { background: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 15%, transparent); color: var(--vscode-textLink-foreground, #89b4fa); border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 35%, transparent); }
  .badge-today { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 12%, transparent); color: var(--vscode-testing-iconPassed, #a6e3a1); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 30%, transparent); }
  .badge-due   { background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #fab387) 12%, transparent); color: var(--vscode-editorWarning-foreground, #fab387); border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, #fab387) 30%, transparent); }
  .badge-overdue { background: color-mix(in srgb, var(--vscode-errorForeground, #f38ba8) 12%, transparent); color: var(--vscode-errorForeground, #f38ba8); border-color: color-mix(in srgb, var(--vscode-errorForeground, #f38ba8) 30%, transparent); }
  .empty { font-size: 12px; color: var(--vscode-descriptionForeground); padding: 8px 0; }

  /* ── Weekly bar chart ── */
  .week-bars { display: flex; gap: 5px; height: 90px; padding-bottom: 30px; position: relative; }
  .week-day { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; position: relative; }
  .week-bar-area { flex: 1; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; }
  .bar-done { background: var(--vscode-testing-iconPassed, #a6e3a1); border-radius: 3px 3px 0 0; min-height: 2px; opacity: 0.85; }
  .bar-open { background: var(--vscode-textLink-foreground, #89b4fa); min-height: 2px; opacity: 0.55; }
  .week-day-label { position: absolute; bottom: 0; text-align: center; width: 100%; line-height: 1.3; }
  .week-day-name { font-size: 8px; color: var(--vscode-descriptionForeground); display: block; }
  .week-day-date { font-size: 7px; color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); display: block; opacity: 0.7; }
  .week-day.today::before {
    content: ''; position: absolute; top: 0; bottom: 30px; left: 0; right: 0;
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 8%, transparent);
    border-radius: 4px; pointer-events: none;
  }
  .week-day.today .week-day-name { color: var(--vscode-textLink-foreground, #89b4fa); font-weight: 700; }
  .week-day.today .week-day-date { color: var(--vscode-textLink-foreground, #89b4fa); opacity: 0.7; }
  .week-legend { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; }
  .legend-item { display: flex; align-items: center; gap: 4px; font-size: 9px; color: var(--vscode-descriptionForeground); }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; }

  /* ── Categories ── */
  .cat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
  .cat-row:last-child { margin-bottom: 0; }
  .cat-label { font-size: 11px; width: 90px; flex-shrink: 0; color: var(--vscode-foreground); }
  .cat-bar-wrap { flex: 1; height: 6px; background: var(--vscode-panel-border, #313244); border-radius: 3px; overflow: hidden; }
  .cat-bar { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--vscode-textLink-foreground, #89b4fa), var(--vscode-badge-foreground, #cba6f7)); }
  .cat-count { font-size: 10px; color: var(--vscode-descriptionForeground); width: 20px; text-align: right; flex-shrink: 0; }

  /* ── AI Actions ── */
  .ai-card {
    background: linear-gradient(135deg, var(--vscode-editorWidget-background, #1e1e2e), #1e1a2e);
    border-color: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 20%, transparent);
  }
  .ai-card .card-title { color: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 80%, var(--vscode-descriptionForeground)); }
  .ai-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  #ai-status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; min-height: 16px; font-style: italic; }
  #ai-status.error { color: var(--vscode-errorForeground); font-style: normal; }

  /* ── Plan / Extract results (unchanged from original) ── */
  .plan-result { margin-top: 8px; }
  .plan-summary { font-size: 12px; font-style: italic; margin-bottom: 8px; color: var(--vscode-descriptionForeground); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .plan-hours { font-size: 11px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 1px 7px; font-style: normal; }
  .plan-item { padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border, #0001); font-size: 12px; }
  .plan-item-header { display: flex; gap: 8px; align-items: baseline; }
  .plan-priority { font-size: 11px; flex-shrink: 0; }
  .plan-task { flex: 1; }
  .plan-dur { color: var(--vscode-descriptionForeground); font-size: 11px; flex-shrink: 0; }
  .plan-reason { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; padding-left: 20px; }
  .extract-task { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; font-size: 12px; }
  .extract-info { flex: 1; }
  .extract-meta { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .due-badge { font-size: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; padding: 0 4px; margin-left: 4px; vertical-align: middle; }
  .due-overdue { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #f48771); }
</style>
</head>
<body>
<div class="header">
  <div class="header-title">📋 AI Task Dashboard</div>
  <div class="header-date">${escHtml(data.today)}</div>
  <div class="header-stats">Open: ${data.totalOpen} / Done: ${data.totalDone}</div>
  <button class="btn" id="btn-refresh">⟳ Refresh</button>
</div>

<div class="grid">
  <div class="card" id="today-tasks-card">
     <h2>Today's Tasks (${data.upcomingTasks.filter((t: DashTask) => !t.done).length} open)</h2>
    ${todayTasksHtml}
  </div>
  <div class="card">
    <h2>Weekly Overview</h2>
    <div class="week-bars">${weekBarsHtml}</div>
  </div>
</div>

<div class="card" style="margin-bottom:var(--gap)">
  <h2>Categories (open tasks)</h2>
  ${catHtml}
</div>

<div class="card" id="ai-card">
  <h2>AI Actions</h2>
  <div class="ai-row">
    <button class="btn btn-primary" id="btn-plan-day">✨ Plan My Day</button>
    <button class="btn" id="btn-ai-extract">🤖 AI Extract from Moments</button>
  </div>
  <div id="ai-status"></div>
  <div id="ai-result"></div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

function refresh() { vscode.postMessage({ command: 'refresh' }); }
function toggleTask(el, taskId) { vscode.postMessage({ command: 'toggleTask', taskId, done: el.checked }); }
function openFile(filePath, lineIndex) { vscode.postMessage({ command: 'openFile', filePath, lineIndex }); }
function planDay() {
  setStatus('processing', 'AIがプランを生成中...');
  document.getElementById('ai-result').innerHTML = '';
  vscode.postMessage({ command: 'planDay' });
}
function aiExtract() {
  setStatus('processing', '今日のMomentsをAIが分析中...');
  document.getElementById('ai-result').innerHTML = '';
  vscode.postMessage({ command: 'aiExtract' });
}
function setStatus(type, msg) {
  const el = document.getElementById('ai-status');
  el.className = type === 'error' ? 'error' : '';
  el.textContent = msg;
}

document.getElementById('btn-refresh')?.addEventListener('click', refresh);
document.getElementById('btn-plan-day')?.addEventListener('click', planDay);
document.getElementById('btn-ai-extract')?.addEventListener('click', aiExtract);

document.getElementById('today-tasks-card')?.addEventListener('change', function(e) {
  const target = e.target;
  if (target && target.type === 'checkbox') {
    const taskId = target.dataset.taskId;
    if (taskId) toggleTask(target, taskId);
  }
});
document.getElementById('today-tasks-card')?.addEventListener('click', function(e) {
  const span = e.target.closest('.task-text');
  if (span) {
    openFile(span.dataset.file || '', parseInt(span.dataset.line || '0', 10));
  }
});

document.getElementById('ai-result')?.addEventListener('click', function(e) {
  const btn = e.target.closest('.add-task-btn');
  if (btn) {
    const idx = parseInt(btn.dataset.idx || '0', 10);
    const el = document.getElementById('ai-result');
    const tasks = el._tasks;
    if (!tasks || !tasks[idx]) return;
    vscode.postMessage({ command: 'addExtractedTask', text: tasks[idx].text, dueDate: tasks[idx].dueDate ?? null });
    btn.disabled = true;
    btn.textContent = '✓';
  }
});

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'aiStatus') {
    setStatus(msg.status, msg.message ?? '');
  } else if (msg.type === 'planDayResult') {
    setStatus('done', '');
    showPlanResult(msg.plan);
  } else if (msg.type === 'extractResult') {
    setStatus('done', '');
    showExtractResult(msg.tasks);
  }
});

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showPlanResult(plan) {
  const el = document.getElementById('ai-result');
  const priorityIcon = { high: '\uD83D\uDD34', medium: '\uD83D\uDFE1', low: '\uD83D\uDD35' };
  const priorityLabel = { high: '\u9ad8', medium: '\u4e2d', low: '\u4f4e' };
  const items = (plan.items || []).map(function(i) {
    const icon = priorityIcon[i.priority] || '\u25CF';
    const label = priorityLabel[i.priority] || i.priority;
    return '<div class="plan-item">' +
      '<div class="plan-item-header">' +
      '<span class="plan-priority plan-priority-' + esc(i.priority) + '">' + icon + ' ' + label + '</span>' +
      '<span class="plan-task">' + esc(i.text) + '</span>' +
      '<span class="plan-dur">' + i.timeEstimateMin + 'min</span>' +
      '</div>' +
      '<div class="plan-reason">' + esc(i.reason) + '</div>' +
      '</div>';
  }).join('');
  const hours = plan.estimatedHours
    ? '<span class="plan-hours">\u5408\u8a08 ' + plan.estimatedHours + 'h\u7a0b\u5ea6</span>'
    : '';
  el.innerHTML = '<div class="plan-result">' +
    '<div class="plan-summary">' + esc(plan.summary) + hours + '</div>' +
    items +
    '</div>';
}

function showExtractResult(tasks) {
  const el = document.getElementById('ai-result');
  const items = tasks.map((t, idx) =>
    \`<div class="extract-task">
      <div class="extract-info">
        <div>\${esc(t.text)}\${t.dueDate ? ' <span class="due-badge">' + esc(t.dueDate) + '</span>' : ''}</div>
        <div class="extract-meta">\${esc(t.category)} · \${esc(t.priority)} · ~\${t.timeEstimateMin}min</div>
      </div>
      <button class="btn add-task-btn" style="font-size:11px" data-idx="\${idx}">+ Add</button>
    </div>\`
  ).join('');
  el._tasks = tasks;
  el.innerHTML = \`<div style="margin-top:8px"><div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px">Momentsから \${tasks.length} 件のタスクを抽出:</div>\${items}</div>\`;
}
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
