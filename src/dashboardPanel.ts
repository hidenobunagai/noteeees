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
          tasks.push({
            id: `${relPath}:${i}`,
            filePath: fullPath,
            lineIndex: i,
            text,
            done,
            date,
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

    const todayTasks = tasks
      .filter((t) => t.date === today || t.date === null)
      .sort((a, b) => (a.done === b.done ? a.text.localeCompare(b.text) : a.done ? 1 : -1));

    const openTasks = tasks.filter((t) => !t.done);

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

    const data = {
      today,
      todayTasks,
      week,
      catCount,
      totalOpen: openTasks.length,
      totalDone: tasks.filter((t) => t.done).length,
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
        const { text } = message as { command: string; text: string };
        void this._addExtractedTask(text);
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
      message: "AIがプランを生成中...",
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

  private async _addExtractedTask(text: string): Promise<void> {
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
    fs.writeFileSync(taskFile, `${existing}${sep}- [ ] ${text}\n`, "utf8");

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
    todayTasks: DashTask[];
    week: WeekDay[];
    catCount: Record<string, number>;
    totalOpen: number;
    totalDone: number;
  }): string {
    const nonce = crypto.randomBytes(16).toString("hex");

    const weekMax = Math.max(...data.week.map((d) => d.open + d.done), 1);

    const todayTasksHtml =
      data.todayTasks.length === 0
        ? `<p class="empty">今日のタスクはありません 🎉</p>`
        : data.todayTasks
            .map((t) => {
              const doneClass = t.done ? " done" : "";
              const safeTxt = escHtml(t.text);
              const safeId = escAttr(t.id);
              const safePath = escAttr(t.filePath);
              return `<div class="task-item${doneClass}">
            <input type="checkbox" ${t.done ? "checked" : ""} data-task-id="${safeId}">
            <span class="task-text" data-file="${safePath}" data-line="${t.lineIndex}">${safeTxt}</span>
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
  :root {
    --radius: 6px;
    --gap: 12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: var(--gap);
  }
  h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em;
       color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .header-title { font-size: 15px; font-weight: 600; flex: 1; }
  .header-date { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .header-stats { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .btn { padding: 4px 10px; font-size: 12px; border-radius: var(--radius); border: 1px solid var(--vscode-button-border,transparent);
         cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); margin-bottom: var(--gap); }
  @media (max-width: 500px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--vscode-editorWidget-background,var(--vscode-sideBar-background)); border: 1px solid var(--vscode-panel-border); border-radius: var(--radius); padding: 10px; }
  .task-item { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border,#0002); }
  .task-item:last-child { border-bottom: none; }
  .task-item.done .task-text { text-decoration: line-through; color: var(--vscode-descriptionForeground); }
  .task-text { flex: 1; cursor: pointer; font-size: 12px; line-height: 1.4; }
  .task-text:hover { color: var(--vscode-textLink-foreground); }
  .week-bars { display: flex; gap: 6px; align-items: flex-end; height: 60px; }
  .week-day { display: flex; flex-direction: column; align-items: center; gap: 3px; flex: 1; }
  .week-day.today .week-label { color: var(--vscode-textLink-foreground); font-weight: 600; }
  .week-label { font-size: 10px; }
  .week-bar { flex: 1; width: 100%; display: flex; flex-direction: column-reverse; gap: 1px; min-height: 4px; }
  .bar-done { background: var(--vscode-textLink-foreground); border-radius: 2px 2px 0 0; min-height: 2px; }
  .bar-open { background: var(--vscode-editorWarning-foreground,#e5a; ); border-radius: 2px 2px 0 0; opacity: .7; min-height: 2px; }
  .week-count { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .cat-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
  .cat-label { font-size: 11px; width: 80px; flex-shrink: 0; }
  .cat-bar-wrap { flex: 1; height: 8px; background: var(--vscode-panel-border); border-radius: 4px; overflow: hidden; }
  .cat-bar { height: 100%; background: var(--vscode-progressBar-background,var(--vscode-textLink-foreground)); border-radius: 4px; }
  .cat-count { font-size: 11px; color: var(--vscode-descriptionForeground); width: 20px; text-align: right; }
  .ai-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  #ai-status { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px; min-height: 18px; }
  #ai-status.error { color: var(--vscode-errorForeground); }
  .plan-result { margin-top: 8px; }
  .plan-summary { font-size: 12px; font-style: italic; margin-bottom: 8px; color: var(--vscode-descriptionForeground); }
  .plan-item { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border,#0001); font-size: 12px; }
  .plan-time { width: 44px; flex-shrink: 0; font-variant-numeric: tabular-nums; color: var(--vscode-textLink-foreground); }
  .plan-dur { color: var(--vscode-descriptionForeground); width: 50px; flex-shrink: 0; text-align: right; }
  .extract-task { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; font-size: 12px; }
  .extract-info { flex: 1; }
  .extract-meta { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .empty { font-size: 12px; color: var(--vscode-descriptionForeground); padding: 8px 0; }
  input[type="checkbox"] { accent-color: var(--vscode-textLink-foreground); cursor: pointer; margin-top: 2px; flex-shrink: 0; }
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
    <h2>Today's Tasks (${data.todayTasks.filter((t) => !t.done).length} open)</h2>
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
    vscode.postMessage({ command: 'addExtractedTask', text: tasks[idx].text });
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
  const items = (plan.items || []).map(i =>
    \`<div class="plan-item"><span class="plan-time">\${esc(i.time)}</span><span class="plan-task">\${esc(i.task)}</span><span class="plan-dur">\${i.durationMin}min</span></div>\`
  ).join('');
  el.innerHTML = \`<div class="plan-result"><div class="plan-summary">\${esc(plan.summary)}</div>\${items}</div>\`;
}

function showExtractResult(tasks) {
  const el = document.getElementById('ai-result');
  const items = tasks.map((t, idx) =>
    \`<div class="extract-task">
      <div class="extract-info">
        <div>\${esc(t.text)}</div>
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
