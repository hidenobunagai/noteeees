import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface MomentEntry {
  index: number; // 0-based line index in the body
  time: string; // HH:mm
  text: string; // content after the time
  isTask: boolean;
  done: boolean;
}

export type MomentFilter = "all" | "openTasks";

export function filterMomentEntries(entries: MomentEntry[], filter: MomentFilter): MomentEntry[] {
  if (filter === "openTasks") {
    return entries.filter((entry) => entry.isTask && !entry.done);
  }

  return entries;
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

function getMomentsFilePath(notesDir: string, date: string): string {
  const subfolder = getMomentsSubfolder();
  return path.join(notesDir, subfolder, `${date}.md`);
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
  // Find the actual line corresponding to this entry's line index
  // We need to map entry.index (body line index) back to file line index
  let bodyStart = 0;
  if (raw.startsWith("---")) {
    // Skip front matter: find second ---
    let fmEnd = raw.indexOf("\n---", 3);
    if (fmEnd !== -1) {
      bodyStart = raw.slice(0, fmEnd + 4).split("\n").length;
    }
  }

  const fileLineIdx = bodyStart + index;
  if (fileLineIdx >= lines.length) {
    return;
  }

  const line = lines[fileLineIdx];
  if (line.match(/^-\s+\[x\]/i)) {
    lines[fileLineIdx] = line.replace(/^(-\s+)\[x\]/i, "$1[ ]");
  } else if (line.match(/^-\s+\[ \]/)) {
    lines[fileLineIdx] = line.replace(/^(-\s+)\[ \]/, "$1[x]");
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
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
          toggleTask(notesDir, this._currentDate, message.index);
          this._sendEntries();
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
    const entries = notesDir ? readMoments(notesDir, this._currentDate) : [];
    const today = formatDate(new Date());
    const sendOnEnter = getSendOnEnter();

    this._view.webview.postMessage({
      command: "update",
      entries,
      date: this._currentDate,
      isToday: this._currentDate === today,
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
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
    flex-shrink: 0;
    gap: 4px;
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
    padding: 8px 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-state {
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    margin-top: 24px;
    opacity: 0.6;
  }

  .entry {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    transition: background 0.1s, border-color 0.1s;
    word-break: break-word;
  }
  .entry:hover { background: var(--vscode-list-hoverBackground); }

  .task-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border-radius: 4px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    background: transparent;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }

  .task-check:hover {
    border-color: var(--vscode-textLink-foreground);
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
  }

  .task-check:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .task-check-icon {
    font-size: 11px;
    line-height: 1;
    opacity: 0;
  }

  .entry.is-task.task-done .task-check {
    border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 40%, var(--vscode-panel-border));
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
  }

  .entry.is-task.task-done .task-check-icon {
    opacity: 1;
  }

  .entry.is-task.task-done {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 8%, var(--vscode-editor-background));
    border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 35%, var(--vscode-panel-border));
  }

  .entry.is-task.task-done .entry-text {
    color: var(--vscode-textLink-foreground);
    text-decoration: line-through;
  }

  .time-badge {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    padding-top: 1px;
    flex-shrink: 0;
  }

  .entry-body {
    flex: 1;
    display: flex;
    align-items: flex-start;
    gap: 5px;
  }

  .entry-text {
    flex: 1;
    line-height: 1.45;
    font-size: 12.5px;
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
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
    border-color: var(--vscode-textLink-foreground);
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
  <button class="nav-btn" id="prevBtn" title="Previous day">&#8249;</button>
  <span class="date-label" id="dateLabel">—</span>
  <button class="nav-btn" id="openTasksBtn" title="Show open tasks only">Open</button>
  <button class="nav-btn" id="todayBtn" title="Go to today">Today</button>
  <button class="nav-btn" id="nextBtn" title="Next day">&#8250;</button>
  <button class="open-btn" id="openFileBtn" title="Open file in editor">&#8599;</button>
</div>

<div class="timeline" id="timeline">
  <div class="empty-state" id="emptyState">No moments yet today</div>
</div>

<div class="input-area">
  <div id="errorBanner" style="display:none"></div>
  <textarea id="inputBox" rows="1" placeholder="Capture a thought…"></textarea>
  <div class="input-actions">
    <button class="task-toggle" id="taskToggle" title="Toggle task mode">Task</button>
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
  const openTasksBtn = document.getElementById('openTasksBtn');
  const todayBtn = document.getElementById('todayBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const openFileBtn = document.getElementById('openFileBtn');
  const hintText = document.getElementById('hintText');
  const errorBanner = document.getElementById('errorBanner');
  let activeFilter = 'all';
  let latestEntries = [];
  let latestDate = '';
  let latestIsToday = true;

  // Notify extension we're ready
  vscode.postMessage({ command: 'ready' });

  // ---- Message from extension ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      sendOnEnter = msg.sendOnEnter;
      latestEntries = msg.entries;
      latestDate = msg.date;
      latestIsToday = msg.isToday;
      updateHint();
      renderTimeline(latestEntries, latestDate, latestIsToday);
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

  function renderTimeline(entries, date, isToday) {
    const visibleEntries = activeFilter === 'openTasks'
      ? entries.filter((entry) => entry.isTask && !entry.done)
      : entries;

    // Update date header
    const today = new Date();
    const todayStr = formatDateLocal(today);
    let label = date;
    if (isToday) label = 'Today · ' + date;
    else if (date === offsetDate(todayStr, -1)) label = 'Yesterday · ' + date;
    dateLabel.textContent = label;
    dateLabel.className = 'date-label' + (isToday ? ' is-today' : '');
    openTasksBtn.classList.toggle('active', activeFilter === 'openTasks');
    openTasksBtn.setAttribute('aria-pressed', String(activeFilter === 'openTasks'));

    // Update Today button visibility
    todayBtn.style.display = isToday ? 'none' : '';

    if (visibleEntries.length === 0) {
      emptyState.style.display = 'block';
      timeline.querySelectorAll('.entry').forEach(e => e.remove());
      if (activeFilter === 'openTasks') {
        emptyState.textContent = isToday ? 'No open tasks today' : 'No open tasks on this day';
      } else {
        emptyState.textContent = isToday ? 'No moments yet — capture your first thought!' : 'No moments on this day';
      }
      return;
    }

    emptyState.style.display = 'none';

    // Rebuild entries
    timeline.querySelectorAll('.entry').forEach(e => e.remove());

    visibleEntries.forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'entry' + (entry.isTask ? ' is-task' : '') + (entry.done ? ' task-done' : '');

      const timeBadge = document.createElement('span');
      timeBadge.className = 'time-badge';
      timeBadge.textContent = entry.time;

      const body = document.createElement('div');
      body.className = 'entry-body';

      const textSpan = document.createElement('span');
      textSpan.className = 'entry-text';
      textSpan.innerHTML = renderText(entry.text);

      if (entry.isTask) {
        const toggleTask = (event) => {
          if (event.target instanceof HTMLElement && event.target.closest('a')) {
            return;
          }
          vscode.postMessage({ command: 'toggleTask', index: entry.index });
        };

        const toggleButton = document.createElement('button');
        toggleButton.className = 'task-check';
        toggleButton.type = 'button';
        toggleButton.setAttribute('role', 'checkbox');
        toggleButton.setAttribute('aria-checked', String(entry.done));
        toggleButton.setAttribute('aria-label', entry.done ? 'Mark task as not done' : 'Mark task as done');
        toggleButton.title = entry.done ? 'Mark task as not done' : 'Mark task as done';
        toggleButton.innerHTML = '<span class="task-check-icon">✓</span>';
        toggleButton.addEventListener('click', toggleTask);
        body.appendChild(toggleButton);
      }

      body.appendChild(textSpan);

      div.appendChild(timeBadge);
      div.appendChild(body);
      timeline.appendChild(div);
    });

    // Scroll to bottom
    timeline.scrollTop = timeline.scrollHeight;
  }

  // ---- Input ----
  taskToggle.addEventListener('click', () => {
    isTaskMode = !isTaskMode;
    taskToggle.classList.toggle('active', isTaskMode);
    taskToggle.textContent = isTaskMode ? '✓ Task' : 'Task';
  });

  function send() {
    const text = inputBox.value.trim();
    if (!text) return;
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
    inputBox.style.height = 'auto';
    inputBox.style.height = Math.min(inputBox.scrollHeight, 120) + 'px';
  }

  // ---- Navigation ----
  prevBtn.addEventListener('click', () => vscode.postMessage({ command: 'navigate', delta: -1 }));
  nextBtn.addEventListener('click', () => vscode.postMessage({ command: 'navigate', delta: 1 }));
  todayBtn.addEventListener('click', () => vscode.postMessage({ command: 'goToday' }));
  openFileBtn.addEventListener('click', () => vscode.postMessage({ command: 'openFile' }));
  openTasksBtn.addEventListener('click', () => {
    activeFilter = activeFilter === 'openTasks' ? 'all' : 'openTasks';
    renderTimeline(latestEntries, latestDate, latestIsToday);
  });

  // ---- Date helpers (browser-side) ----
  function formatDateLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function offsetDate(date, days) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return formatDateLocal(d);
  }
</script>
</body>
</html>`;
  }
}
