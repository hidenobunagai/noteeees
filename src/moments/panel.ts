import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { DUE_DATE_RE } from "../../shared/taskSyntax.js";
import { MOMENT_TAG_PATTERN, getMomentsFeedDayCount, resolvePinnedEntries } from "./config.js";
import { getMomentsSendOnEnterSetting } from "../notesConfig.js";
import {
  appendMoment,
  collectMomentsFeed,
  deleteMomentEntry,
  ensureMomentsFile,
  getMomentsFilePath,
  saveMomentEdit,
  searchMomentsFeed,
} from "./fileIo.js";
import { formatDateString } from "../dashboardTaskUtils.js";
import { buildWebviewI18nScript, resolveLocale, t } from "../i18n.js";
import { momentsScript, momentsStyle } from "../webview/generated.js";

import type { PinnedEntryData } from "./types.js";

// ---------------------------------------------------------------------------
// WebviewViewProvider
// ---------------------------------------------------------------------------

export class MomentsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "notesMomentsView";

  private _view?: vscode.WebviewView;
  private readonly _getNotesDir: () => string | undefined;
  private readonly _context: vscode.ExtensionContext;
  private _feedSectionCount = getMomentsFeedDayCount();
  private _anchorDate = formatDateString(new Date());

  constructor(getNotesDir: () => string | undefined, context: vscode.ExtensionContext) {
    this._getNotesDir = getNotesDir;
    this._context = context;
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

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const notesDir = this._getNotesDir();
      switch (message.command) {
        case "ready":
          this._feedSectionCount = Math.max(this._feedSectionCount, getMomentsFeedDayCount());
          this._sendEntries();
          break;

        case "loadMore": {
          if (!notesDir) {
            this._sendEntries();
            return;
          }

          this._feedSectionCount += Math.max(1, getMomentsFeedDayCount());
          this._sendEntries();
          break;
        }

        case "refreshFeed": {
          this._sendEntries();
          break;
        }

        case "jumpToDate": {
          if (typeof message.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(message.date)) {
            this._anchorDate = message.date;
            this._feedSectionCount = Math.max(1, getMomentsFeedDayCount());
          }
          this._sendEntries();
          break;
        }

        case "jumpToToday": {
          this._anchorDate = formatDateString(new Date());
          this._feedSectionCount = Math.max(1, getMomentsFeedDayCount());
          this._sendEntries();
          break;
        }

        case "searchMoments": {
          const query = typeof message.query === "string" ? message.query : "";
          const feed = notesDir
            ? await searchMomentsFeed(notesDir, query)
            : { sections: [], hasMoreOlder: false };
          this._view?.webview.postMessage({
            command: "update",
            sections: feed.sections,
            sendOnEnter: getMomentsSendOnEnterSetting(),
            todayDate: formatDateString(new Date()),
            anchorDate: this._anchorDate,
            locale: resolveLocale(),
            pinnedEntries: [],
            hasMoreOlder: false,
          });
          break;
        }

        case "addMoment": {
          if (!notesDir) {
            this._showError(t("notesDirNotConfigured"));
            return;
          }
          if (typeof message.text !== "string" || !message.text.trim()) {
            this._showError(t("momentTextEmpty"));
            return;
          }
          await appendMoment(notesDir, formatDateString(new Date()), message.text);
          // Jump back to today so the new entry is visible.
          this._anchorDate = formatDateString(new Date());
          this._feedSectionCount = Math.max(this._feedSectionCount, getMomentsFeedDayCount());
          this._sendEntries();
          break;
        }

        case "saveEdit": {
          if (!notesDir) {
            this._showError(t("notesDirNotConfigured"));
            return;
          }

          if (typeof message.text !== "string" || typeof message.index !== "number") {
            this._showError(t("momentEditInvalid"));
            return;
          }

          if (
            !(await saveMomentEdit(
              notesDir,
              message.date ?? formatDateString(new Date()),
              message.index,
              message.text,
            ))
          ) {
            this._showError(t("momentSaveFailed"));
            return;
          }

          this._sendEntries();
          break;
        }

        case "requestDeleteEntry": {
          if (!notesDir) {
            this._showError(t("notesDirNotConfigured"));
            return;
          }
          if (typeof message.index !== "number") {
            return;
          }

          void vscode.window
            .showWarningMessage(t("momentDeleteConfirm"), { modal: true }, t("momentDeleteBtn"))
            .then(async (selection) => {
              if (selection !== t("momentDeleteBtn")) {
                return;
              }

              if (
                !(await deleteMomentEntry(
                  notesDir,
                  message.date ?? formatDateString(new Date()),
                  message.index,
                ))
              ) {
                this._showError(t("momentDeleteFailed"));
                return;
              }

              this._sendEntries();
            });
          break;
        }

        case "openInbox": {
          if (!notesDir) {
            this._showError(t("notesDirNotConfigured"));
            return;
          }
          void vscode.commands.executeCommand("notes.showOpenTasksOverview");
          break;
        }

        case "openFile": {
          if (!notesDir) {
            return;
          }
          const currentDate = formatDateString(new Date());
          const filePath = getMomentsFilePath(notesDir, currentDate);
          try {
            await fs.access(filePath);
          } catch {
            await ensureMomentsFile(notesDir, currentDate);
          }
          vscode.workspace.openTextDocument(filePath).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
          break;
        }

        case "exportToNote": {
          if (!notesDir) {
            this._showError(t("notesDirNotConfigured"));
            return;
          }

          const entries: Array<{ date: string; index: number; text: string }> = Array.isArray(
            message.entries,
          )
            ? message.entries
            : [];
          if (entries.length === 0) {
            return;
          }

          entries.sort((a, b) => {
            if (a.date < b.date) {
              return -1;
            }
            if (a.date > b.date) {
              return 1;
            }
            return a.index - b.index;
          });

          const byDate = new Map<string, string[]>();
          for (const e of entries) {
            if (!byDate.has(e.date)) {
              byDate.set(e.date, []);
            }
            byDate.get(e.date)!.push(e.text);
          }

          const lines: string[] = ["# Exported Moments", ""];
          for (const [date, texts] of byDate) {
            lines.push(`## ${date}`);
            for (const text of texts) {
              lines.push(`- ${text}`);
            }
            lines.push("");
          }

          const content = lines.join("\n");
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          const stamp = `${formatDateString(now)}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
          const fileName = `${stamp}_exported-moments.md`;
          const filePath = path.join(notesDir, fileName);

          await fs.writeFile(filePath, content, "utf8");

          void vscode.workspace.openTextDocument(filePath).then((doc) => {
            void vscode.window.showTextDocument(doc);
            void vscode.window.showInformationMessage(
              t("momentsExported", { count: entries.length, name: fileName }),
            );
          });
          break;
        }

        case "pinEntry": {
          if (typeof message.date !== "string" || typeof message.index !== "number") {
            return;
          }
          const pinned = this._getPinnedEntries();
          const pinnedId = `${message.date}:${message.index}`;
          if (!pinned.some((e) => `${e.date}:${e.index}` === pinnedId)) {
            pinned.push({
              date: message.date,
              index: message.index,
              text: typeof message.text === "string" ? message.text : "",
              time: typeof message.time === "string" ? message.time : "",
            });
            this._setPinnedEntries(pinned);
          }
          this._sendEntries();
          break;
        }

        case "unpinEntry": {
          if (typeof message.pinnedId !== "string") {
            return;
          }
          const pinned = this._getPinnedEntries();
          this._setPinnedEntries(pinned.filter((e) => `${e.date}:${e.index}` !== message.pinnedId));
          this._sendEntries();
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

  private async _sendEntries(): Promise<void> {
    if (!this._view) {
      return;
    }
    const notesDir = this._getNotesDir();
    const today = formatDateString(new Date());
    const feedSectionCount = Math.max(this._feedSectionCount, getMomentsFeedDayCount());
    this._feedSectionCount = feedSectionCount;
    const anchorDate = this._anchorDate;
    const feed = notesDir
      ? await collectMomentsFeed(notesDir, anchorDate, feedSectionCount)
      : { sections: [], hasMoreOlder: false };
    const sections = feed.sections;
    const sendOnEnter = getMomentsSendOnEnterSetting();

    this._view.webview.postMessage({
      command: "update",
      sections,
      sendOnEnter,
      todayDate: today,
      anchorDate,
      locale: resolveLocale(),
      pinnedEntries: resolvePinnedEntries(this._getPinnedEntries(), sections),
      hasMoreOlder: feed.hasMoreOlder,
    });
  }

  private _showError(msg: string): void {
    this._view?.webview.postMessage({ command: "error", message: msg });
  }

  private _getPinnedEntries(): PinnedEntryData[] {
    return this._context.globalState.get<PinnedEntryData[]>("moments.pinnedEntries", []);
  }

  private _setPinnedEntries(entries: PinnedEntryData[]): void {
    void this._context.globalState.update("moments.pinnedEntries", entries);
  }

  private _getHtml(): string {
    const nonce = crypto.randomBytes(16).toString("hex");
    const dueDatePatternSource = JSON.stringify(DUE_DATE_RE.source);
    const momentTagPatternSource = JSON.stringify(MOMENT_TAG_PATTERN);
    const i18nScript = buildWebviewI18nScript();
    const script = momentsScript
      .replace("__DUE_DATE_PATTERN_SOURCE__", dueDatePatternSource)
      .replace("__MOMENT_TAG_PATTERN__", momentTagPatternSource);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Moments</title>
<style nonce="${nonce}">
${momentsStyle}
</style>
</head>
<body>
  <div class="topbar">
  <div class="topbar-row topbar-row-main">
    <div class="topbar-left">
      <span class="topbar-date" id="topbarDate"></span>
      <span class="topbar-count" id="topbarCount" style="display:none">0</span>
    </div>
    <div class="topbar-right">
      <button class="nav-btn" id="allBtn" title="All moments" aria-label="All moments">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
      </button>
      <button class="nav-btn" id="inboxBtn" title="Task inbox" aria-label="Task inbox">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
      </button>
      <button class="open-btn" id="openFileBtn" title="Open today's file" aria-label="Open today's file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </button>
      <button class="nav-btn" id="jumpDateBtn" title="Jump to date" aria-label="Jump to date">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
      </button>
      <input type="date" id="jumpDateInput" aria-label="Jump to date" />
      <button class="nav-btn" id="backToTodayBtn" title="Back to today" aria-label="Back to today" style="display:none"></button>
      <button class="open-btn export-btn" id="exportBtn" title="Export selected" aria-label="Export selected entries">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
      </button>
    </div>
  </div>
  <div class="topbar-row topbar-row-search">
    <div class="search-bar">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      <input type="text" id="searchInput" placeholder="Search moments..." autocomplete="off" />
      <button id="clearSearch" class="clear-search-btn" title="Clear search" style="display:none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <button class="filter-chip-btn" id="activeTagBtn" title="Clear active hashtag filter" style="display:none"></button>
  </div>
</div>

<div class="input-area">
  <div id="errorBanner" style="display:none"></div>
  <div class="input-container" id="inputContainer">
    <textarea id="inputBox" rows="1" placeholder="Capture a thought... (#tag to categorize)"></textarea>
    <div class="input-actions">
      <button class="send-icon-btn" id="sendBtn" title="Send (Enter)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
      </button>
    </div>
  </div>
</div>

<div class="timeline" id="timeline">
  <div class="empty-state" id="emptyState">
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 8px;">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
  </svg>
  <div id="emptyTitle"></div>
  <div id="emptyHint" style="font-size: 11px; margin-top: 4px; opacity: 0.8;"></div>
</div>
</div>

<div class="export-action-bar" id="exportActionBar">
  <span class="selected-count-label" id="selectedCountLabel"></span>
  <button class="export-note-btn" id="exportNoteBtn"></button>
  <button class="export-cancel-btn" id="exportCancelBtn"></button>
</div>

<script nonce="${nonce}">${i18nScript}</script>
<script nonce="${nonce}">
${script}
</script>
</body>
</html>`;
  }
}
