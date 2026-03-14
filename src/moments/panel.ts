import * as fs from "fs";
import * as vscode from "vscode";
import { MOMENT_TAG_PATTERN, getSendOnEnter } from "./config.js";
import {
  formatDate,
  getMomentsFilePath,
  collectMomentsFeed,
  appendMoment,
  toggleTask,
  convertMomentEntryToTask,
  convertMomentEntryToNote,
  saveMomentEdit,
  deleteMomentEntry,
  ensureMomentsFile,
} from "./fileIo.js";
import { showOpenTasksOverview } from "./taskOverview.js";

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
    align-items: center;
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
      renderTimeline(latestSections);
      if (pendingScrollMode === 'top') {
        timeline.scrollTop = 0;
      }
      pendingScrollMode = null;
    } else if (msg.command === 'error') {
      showError(msg.message);
    }
  });

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
          if (event.isComposing || event.keyCode === 229) {
            return;
          }
          if (event.key === 'Enter') {
            let shouldSave = false;
            if (sendOnEnter && !event.shiftKey) {
              shouldSave = true;
            } else if (!sendOnEnter && (event.metaKey || event.ctrlKey)) {
              shouldSave = true;
            }

            if (shouldSave) {
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
