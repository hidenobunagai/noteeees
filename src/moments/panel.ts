import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { DUE_DATE_RE } from "../taskSyntax.js";
import {
  MOMENT_TAG_PATTERN,
  getMomentsFeedDayCount,
  getSendOnEnter,
  resolvePinnedEntries,
} from "./config.js";
import {
  appendMoment,
  collectMomentsFeed,
  deleteMomentEntry,
  ensureMomentsFile,
  formatDate,
  getMomentsFilePath,
  saveMomentEdit,
} from "./fileIo.js";

import type { PinnedEntryData } from "./types.js";

// ---------------------------------------------------------------------------
// WebviewViewProvider
// ---------------------------------------------------------------------------

export class MomentsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "notesMomentsView";

  private _view?: vscode.WebviewView;
  private readonly _getNotesDir: () => string | undefined;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private _feedSectionCount = getMomentsFeedDayCount();

  constructor(
    getNotesDir: () => string | undefined,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ) {
    this._getNotesDir = getNotesDir;
    this._extensionUri = extensionUri;
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

    webviewView.webview.html = this._getHtml(webviewView.webview);

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

        case "addMoment": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }
          if (typeof message.text !== "string" || !message.text.trim()) {
            this._showError("Moment text must not be empty.");
            return;
          }
          await appendMoment(notesDir, formatDate(new Date()), message.text);
          this._sendEntries();
          break;
        }

        case "saveEdit": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }

          if (typeof message.text !== "string" || typeof message.index !== "number") {
            this._showError("Invalid Moment edit parameters.");
            return;
          }

          if (
            !(await saveMomentEdit(
              notesDir,
              message.date ?? formatDate(new Date()),
              message.index,
              message.text,
            ))
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
          if (typeof message.index !== "number") {
            return;
          }

          void vscode.window
            .showWarningMessage("Delete this Moment entry?", { modal: true }, "Delete")
            .then(async (selection) => {
              if (selection !== "Delete") {
                return;
              }

              if (
                !(await deleteMomentEntry(
                  notesDir,
                  message.date ?? formatDate(new Date()),
                  message.index,
                ))
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
            this._showError("Notes directory is not configured.");
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
          const stamp = `${formatDate(now)}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
          const fileName = `${stamp}_exported-moments.md`;
          const filePath = path.join(notesDir, fileName);

          await fs.writeFile(filePath, content, "utf8");

          void vscode.workspace.openTextDocument(filePath).then((doc) => {
            void vscode.window.showTextDocument(doc);
            void vscode.window.showInformationMessage(
              `Exported ${entries.length} moment(s) to ${fileName}`,
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
    const today = formatDate(new Date());
    const feedSectionCount = Math.max(this._feedSectionCount, getMomentsFeedDayCount());
    this._feedSectionCount = feedSectionCount;
    const feed = notesDir
      ? await collectMomentsFeed(notesDir, today, feedSectionCount)
      : { sections: [], hasMoreOlder: false };
    const sections = feed.sections;
    const sendOnEnter = getSendOnEnter();

    this._view.webview.postMessage({
      command: "update",
      sections,
      sendOnEnter,
      todayDate: today,
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

  private _getHtml(webview: vscode.Webview): string {
    const toolkitUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "toolkit.min.js"),
    );
    const dueDatePatternSource = JSON.stringify(DUE_DATE_RE.source);

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
    --moments-inline-padding: 10px;
    --moments-control-radius: 6px;
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
    padding: 10px var(--moments-inline-padding) 8px;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
    gap: 8px;
  }

  .topbar-row {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .topbar-row-main {
    justify-content: space-between;
    gap: 10px;
  }

  .topbar-row-search {
    align-items: stretch;
    gap: 8px;
    width: 100%;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .topbar-date {
    color: var(--vscode-foreground);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    line-height: 1.3;
  }

  .topbar-count {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
    color: var(--vscode-textLink-foreground);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    line-height: 1;
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    text-align: center;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    opacity: 0.65;
    transition: opacity 0.15s, background 0.15s;
    min-width: 28px;
    min-height: 28px;
  }
  .nav-btn svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }
  .nav-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

  .nav-btn.active {
    opacity: 1;
    color: var(--vscode-foreground);
    background: var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-foreground) 10%, transparent));
    border-radius: 4px;
  }

  .open-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    opacity: 0.5;
    min-width: 28px;
    min-height: 28px;
    transition: opacity 0.15s, background 0.15s;
  }
  .open-btn svg {
    width: 13px;
    height: 13px;
    fill: currentColor;
  }
  .open-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

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
    gap: 6px;
    padding: 6px var(--moments-inline-padding) 8px;
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
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--moments-control-radius);
    transition: background 0.1s, border-color 0.1s;
    word-break: break-word;
  }
  .entry:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-focusBorder, var(--vscode-panel-border));
  }

  .entry-meta {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .entry-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .entry-header-leading {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .entry-time {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }


  .entry-content {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }


  .entry-text {
    line-height: 1.45;
    font-size: 12.5px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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

  .entry-header-actions {
    flex: none;
    flex-wrap: nowrap;
    justify-content: flex-end;
    margin-left: auto;
    gap: 2px;
    padding: 2px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 90%, transparent);
  }

  .entry:hover .entry-header-actions,
  .entry:focus-within .entry-header-actions {
    background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)) 80%, transparent);
  }

  .entry-action,
  .pin-btn {
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

  .pin-btn {
    font-size: 12px;
    line-height: 1;
  }

  .entry-action svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .entry-action:hover,
  .pin-btn:hover {
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

  .due-date-inline {
    display: inline-block;
    padding: 0 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--vscode-charts-orange, #e8a838) 18%, transparent);
    color: var(--vscode-charts-orange, #e8a838);
    font-size: 11px;
    font-weight: 500;
    margin: 0 1px;
    line-height: 1.4;
    white-space: nowrap;
  }

  /* ---- Due date badges ---- */
  .due-badge {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    color: var(--vscode-descriptionForeground);
  }

  .due-overdue .due-badge {
    background: color-mix(in srgb, var(--vscode-errorForeground, #f44) 20%, transparent);
    color: var(--vscode-errorForeground, #f44);
  }

  .due-today .due-badge {
    background: color-mix(in srgb, #f08 20%, transparent);
    color: color-mix(in srgb, var(--vscode-charts-orange, #e8a838) 100%, transparent);
  }

  .due-upcoming .due-badge {
    background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
    color: var(--vscode-descriptionForeground);
    opacity: 0.75;
  }

  /* ---- Input area ---- */
  .input-area {
    flex-shrink: 0;
    padding: 8px var(--moments-inline-padding) 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }

  .input-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: var(--moments-control-radius);
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

  /* Bottom row: send button */
  .input-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 2px 6px 6px 8px;
    gap: 5px;
  }

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

  /* ---- Search bar ---- */
  .search-bar {
    position: relative;
    width: 100%;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 7px;
    top: 50%;
    transform: translateY(-50%);
    width: 13px;
    height: 13px;
    fill: var(--vscode-descriptionForeground);
    opacity: 0.6;
    pointer-events: none;
  }

  .search-bar input {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: var(--moments-control-radius);
    padding: 5px 26px 5px 26px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  .search-bar input:focus {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .search-bar input::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }

  .clear-search-btn {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 3px;
    border-radius: 3px;
    opacity: 0.6;
    transition: opacity 0.15s, background 0.15s;
  }
  .clear-search-btn svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
  .clear-search-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

  .filter-chip-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    min-width: 0;
    max-width: 40%;
    border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 35%, var(--vscode-panel-border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
    color: var(--vscode-textLink-foreground);
    padding: 0 8px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }

  .filter-chip-btn:hover {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
    border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 50%, var(--vscode-panel-border));
  }

  /* ---- Export select mode ---- */
  .export-btn.active {
    opacity: 1;
    color: var(--vscode-textLink-foreground);
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
    border-radius: 4px;
  }

  .select-entry-cb {
    display: none;
    flex: none;
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--vscode-textLink-foreground);
    cursor: pointer;
    margin-top: 1px;
  }

  body.select-mode .select-entry-cb {
    display: block;
  }

  .entry.selected-for-export {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, var(--vscode-editor-background));
    border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 30%, var(--vscode-panel-border));
  }

  .export-action-bar {
    flex-shrink: 0;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px var(--moments-inline-padding);
    border-top: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  }

  body.select-mode .export-action-bar {
    display: flex;
  }

  .selected-count-label {
    flex: 1;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .export-note-btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 3px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .export-note-btn:hover { background: var(--vscode-button-hoverBackground); }
  .export-note-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .export-cancel-btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 3px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .export-cancel-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* ---- Pinned section ---- */
  .pinned-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px var(--moments-inline-padding) 8px;
    border-bottom: 2px solid var(--vscode-textLink-foreground);
  }

  .pinned-section-header {
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

  .pinned-section-label {
    color: var(--vscode-textLink-foreground);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }

  .pinned-entry {
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 6%, var(--vscode-editor-background));
    border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 40%, transparent);
  }
  .pinned-entry:hover { background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, var(--vscode-list-hoverBackground)); }

  .pin-btn.pinned { opacity: 1; color: var(--vscode-textLink-foreground); }
  .pin-btn:not(.pinned) { opacity: 0.45; }
  .entry:hover .pin-btn:not(.pinned),
  .entry:focus-within .pin-btn:not(.pinned) {
    opacity: 0.8;
    color: var(--vscode-foreground);
  }
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
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M1.5 2.5h13l.5.5v2l-.5.5h-13l-.5-.5V3l.5-.5zm7 4h6l.5.5v2l-.5.5h-6l-.5-.5V7l.5-.5zm-7 4h13l.5.5v2l-.5.5h-13l-.5-.5v-2l.5-.5zm7 4h6l.5.5v2l-.5.5h-6l-.5-.5v-2l.5-.5z"/></svg>
      </button>
      <button class="nav-btn" id="inboxBtn" title="Task inbox" aria-label="Task inbox">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2.5 1.5h11l.5.5v3l-3 5.5v3.5l-1.5 1-1.5-1v-3.5l-3-5.5V2l.5-.5zm1 1v1.5l3 5.5v3l1 .5 1-.5V8.5l3-5.5V2.5h-8z"/></svg>
      </button>
      <button class="open-btn" id="openFileBtn" title="Open today's file" aria-label="Open today's file">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.5 1.5H6L5.44 1l-.22.22L3 3.5H1.5l-.5.5v10l.5.5h12l.5-.5V2l-.5-.5zM3 4.5H2v9h11V4.5H3zm7.5-2H6.5l-.22.22L5 4h7V2.5z"/></svg>
      </button>
      <button class="open-btn export-btn" id="exportBtn" title="Export selected" aria-label="Export selected entries">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2H1.5l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zM2 3h12v10H2V3zm2 1h8v1H4V4zm0 3h8v1H4V7zm0 3h5v1H4v-1z"/></svg>
      </button>
    </div>
  </div>
  <div class="topbar-row topbar-row-search">
    <div class="search-bar">
      <svg class="search-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.2 9.5l4.4 4.4-.7.7-4.4-4.4a5.5 5.5 0 111.5-5.5 5.5 5.5 0 01-1.5 5.5h.7zm-4.7.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z"/></svg>
      <input type="text" id="searchInput" placeholder="Search moments..." autocomplete="off" />
      <button id="clearSearch" class="clear-search-btn" title="Clear search" style="display:none">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.7 8l3.15-3.15-.7-.7L8 7.3 4.85 4.15l-.7.7L7.3 8l-3.15 3.15.7.7L8 8.7l3.15 3.15.7-.7L8.7 8z"/></svg>
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
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14.5 1.5l-14 5v1.5l5 1.5 8.5-8-6.5 9.5v3.5l2.5-3 3.5 2h1.5l2-15h-1.5z"/></svg>
      </button>
    </div>
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

<div class="export-action-bar" id="exportActionBar">
  <span class="selected-count-label" id="selectedCountLabel">0 selected</span>
  <button class="export-note-btn" id="exportNoteBtn">Export as Note</button>
  <button class="export-cancel-btn" id="exportCancelBtn">Cancel</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let sendOnEnter = true;
  let isComposing = false; // IME composition guard

  const inputBox = document.getElementById('inputBox');
  const sendBtn = document.getElementById('sendBtn');
  const timeline = document.getElementById('timeline');
  const emptyState = document.getElementById('emptyState');
  const topbarDate = document.getElementById('topbarDate');
  const topbarCount = document.getElementById('topbarCount');
  const inboxBtn = document.getElementById('inboxBtn');
  const allBtn = document.getElementById('allBtn');
  const activeTagBtn = document.getElementById('activeTagBtn');
  const openFileBtn = document.getElementById('openFileBtn');
  const errorBanner = document.getElementById('errorBanner');
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');
  const exportBtn = document.getElementById('exportBtn');
  const selectedCountLabel = document.getElementById('selectedCountLabel');
  const exportNoteBtn = document.getElementById('exportNoteBtn');
  const exportCancelBtn = document.getElementById('exportCancelBtn');
  let activeTag = null;
  let activeTagLabel = '';
  let currentSearchText = '';
  let latestSections = [];
  let currentPinnedEntries = [];
  let editingEntryKey = null;
  let editingText = '';
  let selectMode = false;
  const selectedEntries = new Set();
  let pendingScrollMode = 'top';
  let pendingScrollTop = 0;
  let hasMoreOlder = false;
  let loadingOlder = false;
  let todayDate = '';
  const momentTagPattern = ${JSON.stringify(MOMENT_TAG_PATTERN)};

  // Notify extension we're ready
  vscode.postMessage({ command: 'ready' });

  // ---- Message from extension ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      sendOnEnter = msg.sendOnEnter;
      latestSections = msg.sections;
      todayDate = msg.todayDate || '';
      currentPinnedEntries = msg.pinnedEntries || [];
      hasMoreOlder = Boolean(msg.hasMoreOlder);
      loadingOlder = false;
      updateTopbar(todayDate, latestSections);
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
      } else if (pendingScrollMode === 'preserve') {
        timeline.scrollTop = pendingScrollTop;
      }
      pendingScrollMode = null;
      window.requestAnimationFrame(() => {
        maybeLoadOlderEntries();
      });
    } else if (msg.command === 'error') {
      showError(msg.message);
    }
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
    setTimeout(() => { errorBanner.style.display = 'none'; }, 4000);
  }

  function updateTopbar(dateStr, sections) {
    // Format date label
    if (dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const opts = { month: 'short', day: 'numeric', year: 'numeric' };
      topbarDate.textContent = d.toLocaleDateString('en-US', opts) + ' · Today';
    } else {
      topbarDate.textContent = '';
    }

    // Count today's entries
    const todaySection = sections.find(s => s.isToday);
    const todayCount = todaySection ? todaySection.entries.length : 0;
    if (todayCount > 0) {
      topbarCount.textContent = todayCount + ' moment' + (todayCount !== 1 ? 's' : '');
      topbarCount.style.display = '';
    } else {
      topbarCount.style.display = 'none';
    }

    // Highlight allBtn as active (default view)
    allBtn.classList.add('active');
    allBtn.setAttribute('aria-pressed', 'true');
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
    // Highlight @YYYY-MM-DD due dates
    html = html.replace(/@(\\d{4}-\\d{2}-\\d{2})/g, '<span class="due-date-inline">@$1</span>');
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

  function requestLoadOlderEntries() {
    if (loadingOlder || !hasMoreOlder) {
      return;
    }

    loadingOlder = true;
    pendingScrollMode = 'preserve';
    pendingScrollTop = timeline.scrollTop;
    vscode.postMessage({ command: 'loadMore' });
  }

  function maybeLoadOlderEntries() {
    if (loadingOlder || !hasMoreOlder) {
      return;
    }

    const threshold = 180;
    const nearBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - threshold;
    const contentShort = timeline.scrollHeight <= timeline.clientHeight + threshold;

    if (nearBottom || contentShort) {
      requestLoadOlderEntries();
    }
  }

  function renderTimeline(sections) {
    const visibleSections = sections
      .map((section) => ({
        ...section,
        entries: section.entries
          .filter((entry) => !activeTag || getEntryTags(entry).includes(activeTag))
          .filter((entry) => !currentSearchText || entry.text.toLowerCase().includes(currentSearchText))
          .slice()
          .reverse(),
      }))
      .filter((section) => section.entries.length > 0);

    allBtn.classList.add('active');
    allBtn.setAttribute('aria-pressed', 'true');
    activeTagBtn.style.display = activeTag ? '' : 'none';
    activeTagBtn.textContent = activeTag ? activeTagLabel + ' ×' : '';
    activeTagBtn.title = activeTag ? ('Clear hashtag filter ' + activeTagLabel) : 'Clear active hashtag filter';
    activeTagBtn.setAttribute('aria-label', activeTag ? ('Clear hashtag filter ' + activeTagLabel) : 'Clear active hashtag filter');

    if (visibleSections.length === 0) {
      emptyState.style.display = 'block';
      timeline.querySelectorAll('.day-section, .pinned-section').forEach(e => e.remove());
      if (currentSearchText && activeTag) {
        emptyState.textContent = 'No moments tagged ' + activeTagLabel + ' matching "' + currentSearchText + '"';
      } else if (currentSearchText) {
        emptyState.textContent = 'No moments matching "' + currentSearchText + '"';
      } else if (activeTag) {
        emptyState.textContent = 'No moments tagged ' + activeTagLabel + ' in this recent feed';
      } else {
        emptyState.textContent = 'No moments yet — capture your first thought!';
      }
      return;
    }

    emptyState.style.display = 'none';

    timeline.querySelectorAll('.day-section, .pinned-section').forEach(e => e.remove());

    // Render pinned section
    if (currentPinnedEntries.length > 0) {
      const pinnedSectionEl = document.createElement('section');
      pinnedSectionEl.className = 'pinned-section';

      const pinnedHeader = document.createElement('div');
      pinnedHeader.className = 'pinned-section-header';
      const pinnedLabel = document.createElement('span');
      pinnedLabel.className = 'pinned-section-label';
      pinnedLabel.textContent = '📌 Pinned';
      pinnedHeader.appendChild(pinnedLabel);
      pinnedSectionEl.appendChild(pinnedHeader);

      currentPinnedEntries.forEach((pinned) => {
        const div = document.createElement('div');
        div.className = 'entry pinned-entry';

        const meta = document.createElement('div');
        meta.className = 'entry-meta';

        const dateBadge = document.createElement('span');
        dateBadge.className = 'entry-time';
        dateBadge.textContent = pinned.date + (pinned.time ? ' · ' + pinned.time : '');
        meta.appendChild(dateBadge);

        const header = document.createElement('div');
        header.className = 'entry-header';

        const headerLeading = document.createElement('div');
        headerLeading.className = 'entry-header-leading';

        const textSpan = document.createElement('div');
        textSpan.className = 'entry-text';
        textSpan.innerHTML = renderText(pinned.text);
        textSpan.querySelectorAll('.tag').forEach((tagButton) => {
          tagButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setActiveTag(tagButton.dataset.tag || '');
          });
        });

        const content = document.createElement('div');
        content.className = 'entry-content';

        headerLeading.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'entry-actions entry-header-actions';

        const unpinButton = document.createElement('button');
        unpinButton.className = 'pin-btn pinned';
        unpinButton.type = 'button';
        unpinButton.title = 'Unpin';
        unpinButton.setAttribute('aria-label', 'Unpin');
        unpinButton.textContent = '📌';
        unpinButton.addEventListener('click', () => {
          vscode.postMessage({ command: 'unpinEntry', pinnedId: pinned.date + ':' + pinned.index });
        });
        actions.appendChild(unpinButton);

        header.appendChild(headerLeading);
        header.appendChild(actions);
        content.appendChild(header);
        content.appendChild(textSpan);
        div.appendChild(content);
        pinnedSectionEl.appendChild(div);
      });

      timeline.appendChild(pinnedSectionEl);
    }

    visibleSections.forEach((section) => {
      const unpinnedEntries = section.entries.filter(
        (e) => !currentPinnedEntries.some((p) => p.date === section.date && p.index === e.index)
      );
      if (unpinnedEntries.length === 0) return;

      const sectionEl = document.createElement('section');
      sectionEl.className = 'day-section';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'day-section-header';

      const sectionLabel = document.createElement('span');
      sectionLabel.className = 'day-section-label' + (section.isToday ? ' is-today' : '');
      sectionLabel.textContent = section.dateLabel;

      sectionHeader.appendChild(sectionLabel);
      sectionEl.appendChild(sectionHeader);

      unpinnedEntries.forEach((entry) => {
      const entryKey = section.date + ':' + entry.index;
      const exportKey = JSON.stringify({ date: section.date, index: entry.index });
      const div = document.createElement('div');
      div.className = 'entry' + (selectMode && selectedEntries.has(exportKey) ? ' selected-for-export' : '');

      const meta = document.createElement('div');
      meta.className = 'entry-meta';

      const timeBadge = document.createElement('span');
      timeBadge.className = 'entry-time';
      timeBadge.textContent = entry.time;

      meta.appendChild(timeBadge);

      const header = document.createElement('div');
      header.className = 'entry-header';

      const dueDateMatch = entry.text.match(new RegExp(${dueDatePatternSource}, "i"));
      const dueDate = dueDateMatch ? dueDateMatch[1] : null;
      if (dueDate) {
        let dueDateStatus = null;
        if (!entry.done && todayDate) {
          if (dueDate < todayDate) {
            dueDateStatus = 'overdue';
          } else if (dueDate === todayDate) {
            dueDateStatus = 'today';
          } else {
            dueDateStatus = 'upcoming';
          }
        }
        if (dueDateStatus) {
          div.classList.add('due-' + dueDateStatus);
        }
        const dueBadge = document.createElement('span');
        dueBadge.className = 'due-badge';
        dueBadge.textContent = dueDateStatus === 'today' ? 'Today' : dueDate;
        meta.appendChild(dueBadge);
      }

      if (entryKey === editingEntryKey) {
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

      const selectCb = document.createElement('input');
      selectCb.type = 'checkbox';
      selectCb.className = 'select-entry-cb';
      selectCb.checked = selectedEntries.has(exportKey);
      selectCb.setAttribute('aria-label', 'Select entry for export');
      selectCb.addEventListener('change', () => {
        if (selectCb.checked) {
          selectedEntries.add(exportKey);
          div.classList.add('selected-for-export');
        } else {
          selectedEntries.delete(exportKey);
          div.classList.remove('selected-for-export');
        }
        updateExportBar();
      });

      const actions = document.createElement('div');
      actions.className = 'entry-actions entry-header-actions';

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

      const isPinned = currentPinnedEntries.some((p) => p.date === section.date && p.index === entry.index);
      const pinButton = document.createElement('button');
      pinButton.className = 'pin-btn' + (isPinned ? ' pinned' : '');
      pinButton.type = 'button';
      pinButton.title = isPinned ? 'Unpin' : 'Pin';
      pinButton.setAttribute('aria-label', isPinned ? 'Unpin' : 'Pin');
      pinButton.textContent = '📌';
      pinButton.addEventListener('click', () => {
        if (isPinned) {
          vscode.postMessage({ command: 'unpinEntry', pinnedId: section.date + ':' + entry.index });
        } else {
          vscode.postMessage({ command: 'pinEntry', date: section.date, index: entry.index, text: entry.text, time: entry.time });
        }
      });
      actions.appendChild(pinButton);
      actions.appendChild(deleteButton);

      const headerLeading = document.createElement('div');
      headerLeading.className = 'entry-header-leading';
      headerLeading.appendChild(selectCb);
      headerLeading.appendChild(meta);

      header.appendChild(headerLeading);
      header.appendChild(actions);
      content.appendChild(header);
      content.appendChild(textSpan);
      div.appendChild(content);
      sectionEl.appendChild(div);
    });

      timeline.appendChild(sectionEl);
    });
  }

  function send() {
    const text = inputBox.value.trim();
    if (!text) return;
    pendingScrollMode = 'top';
    vscode.postMessage({ command: 'addMoment', text });
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
  timeline.addEventListener('scroll', () => {
    maybeLoadOlderEntries();
  }, { passive: true });
  allBtn.addEventListener('click', () => {
    renderTimeline(latestSections);
  });
  activeTagBtn.addEventListener('click', () => {
    activeTag = null;
    activeTagLabel = '';
    renderTimeline(latestSections);
  });

  searchInput.addEventListener('input', () => {
    currentSearchText = searchInput.value.toLowerCase();
    clearSearch.style.display = currentSearchText ? '' : 'none';
    renderTimeline(latestSections);
  });

  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    currentSearchText = '';
    clearSearch.style.display = 'none';
    searchInput.focus();
    renderTimeline(latestSections);
  });

  function updateExportBar() {
    const count = selectedEntries.size;
    selectedCountLabel.textContent = count + ' selected';
    exportNoteBtn.disabled = count === 0;
  }

  function enterSelectMode() {
    selectMode = true;
    document.body.classList.add('select-mode');
    exportBtn.classList.add('active');
    selectedEntries.clear();
    updateExportBar();
    renderTimeline(latestSections);
  }

  function exitSelectMode() {
    selectMode = false;
    document.body.classList.remove('select-mode');
    exportBtn.classList.remove('active');
    selectedEntries.clear();
    renderTimeline(latestSections);
  }

  exportBtn.addEventListener('click', () => {
    if (selectMode) {
      exitSelectMode();
    } else {
      enterSelectMode();
    }
  });

  exportCancelBtn.addEventListener('click', exitSelectMode);

  exportNoteBtn.addEventListener('click', () => {
    if (selectedEntries.size === 0) { return; }
    const entriesData = [];
    for (const key of selectedEntries) {
      const { date, index } = JSON.parse(key);
      const sectionData = latestSections.find(s => s.date === date);
      if (sectionData) {
        const entryData = sectionData.entries.find(e => e.index === index);
        if (entryData) {
          entriesData.push({ date, index, text: entryData.text });
        }
      }
    }
    if (entriesData.length > 0) {
      vscode.postMessage({ command: 'exportToNote', entries: entriesData });
    }
    exitSelectMode();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectMode && editingEntryKey === null) {
      exitSelectMode();
    }
  });
</script>
</body>
</html>`;
  }
}
