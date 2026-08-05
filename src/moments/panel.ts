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
} from "./fileIo.js";
import { formatDateString } from "../dashboardTaskUtils.js";

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

        case "addMoment": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
            return;
          }
          if (typeof message.text !== "string" || !message.text.trim()) {
            this._showError("Moment text must not be empty.");
            return;
          }
          await appendMoment(notesDir, formatDateString(new Date()), message.text);
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
              message.date ?? formatDateString(new Date()),
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
                  message.date ?? formatDateString(new Date()),
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

        case "openInbox": {
          if (!notesDir) {
            this._showError("Notes directory is not configured.");
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
          const stamp = `${formatDateString(now)}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
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
    const today = formatDateString(new Date());
    const feedSectionCount = Math.max(this._feedSectionCount, getMomentsFeedDayCount());
    this._feedSectionCount = feedSectionCount;
    const feed = notesDir
      ? await collectMomentsFeed(notesDir, today, feedSectionCount)
      : { sections: [], hasMoreOlder: false };
    const sections = feed.sections;
    const sendOnEnter = getMomentsSendOnEnterSetting();

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

  private _getHtml(): string {
    const dueDatePatternSource = JSON.stringify(DUE_DATE_RE.source);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Moments</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    --moments-inline-padding: 10px;
    --moments-control-radius: 6px;
    --moments-surface: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    --moments-accent: var(--vscode-textLink-foreground);
    --moments-muted: var(--vscode-descriptionForeground);
    --moments-border: var(--vscode-panel-border);
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
    background: var(--moments-surface);
    border-bottom: 1px solid var(--moments-border);
    flex-shrink: 0;
    gap: 8px;
  }

  .topbar-row {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .topbar-row-main {
    flex-wrap: wrap;
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
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }

  .topbar-date {
    color: var(--vscode-foreground);
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .topbar-count {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--moments-accent) 12%, transparent);
    color: var(--moments-accent);
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
    padding: 2px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--moments-border) 85%, transparent);
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
    gap: 10px;
    padding: 8px var(--moments-inline-padding) 12px 28px;
    position: relative;
  }

  /* Vertical timeline line */
  .day-section::before {
    content: "";
    position: absolute;
    left: 17px;
    top: 42px;
    bottom: 12px;
    width: 2px;
    background: color-mix(in srgb, var(--moments-border) 60%, transparent);
    border-radius: 999px;
  }

  .day-section-header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 12px;
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 75%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid color-mix(in srgb, var(--moments-border) 40%, transparent);
    margin-bottom: 4px;
    margin-left: -28px;
  }

  .day-section-label {
    color: var(--moments-muted);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    letter-spacing: 0.05em;
  }

  .day-section-label.is-today {
    color: var(--moments-accent);
  }

  .empty-state {
    text-align: center;
    color: var(--moments-muted);
    font-size: 12px;
    margin: 24px 12px 0;
    opacity: 0.6;
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px 10px;
    background: var(--vscode-editor-background);
    border: 1px solid color-mix(in srgb, var(--moments-border) 75%, transparent);
    border-radius: 8px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    word-break: break-word;
    position: relative;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  /* Timeline Dot */
  .entry::before {
    content: "";
    position: absolute;
    left: -16px;
    top: 18px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--moments-border);
    border: 2px solid var(--vscode-sideBar-background, var(--vscode-editor-background));
    transition: all 0.2s ease;
    z-index: 2;
  }

  .entry:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: color-mix(in srgb, var(--moments-accent) 45%, var(--moments-border));
    transform: translateY(-1px);
    box-shadow: 0 4px 8px -2px rgba(0, 0, 0, 0.12);
  }

  .entry:hover::before {
    background: var(--moments-accent);
    transform: scale(1.2);
  }

  .entry-meta {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    color: var(--moments-muted);
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
    padding: 0 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
    color: var(--moments-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    font-size: 10px;
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
    border-radius: 6px;
    border: 1px solid var(--moments-border);
    padding: 8px;
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
    background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--moments-border) 90%, transparent);
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
    color: var(--moments-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    font-size: 11px;
    opacity: 0.8;
    transition: all 0.15s ease;
  }

  .pin-btn {
    font-size: 12px;
    line-height: 1;
  }

  .entry-action svg,
  .pin-btn svg {
    width: 14px;
    height: 14px;
    stroke-width: 2.2;
  }

  .entry-action:hover,
  .pin-btn:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    opacity: 1;
    transform: translateY(-0.5px);
  }

  .entry-action.primary {
    color: var(--moments-accent);
  }

  .entry-action.danger:hover {
    color: var(--vscode-errorForeground);
  }

  .entry-action.save {
    color: var(--moments-accent);
  }

  .tag {
    display: inline-block;
    border: none;
    padding: 0 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--moments-accent) 15%, transparent);
    color: var(--moments-accent);
    font-size: 11px;
    font-weight: 500;
    margin: 0 1px;
    text-decoration: none;
    font-family: inherit;
    line-height: 1.4;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .tag:hover {
    background: color-mix(in srgb, var(--moments-accent) 25%, transparent);
  }

  .due-date-inline {
    display: inline-block;
    padding: 0 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--vscode-charts-orange, #e8a838) 15%, transparent);
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
    padding: 0 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
    color: var(--moments-muted);
  }

  .due-overdue .due-badge {
    background: color-mix(in srgb, var(--vscode-errorForeground, #f44) 18%, transparent);
    color: var(--vscode-errorForeground, #f44);
  }

  .due-today .due-badge {
    background: color-mix(in srgb, var(--vscode-charts-orange, #e8a838) 18%, transparent);
    color: var(--vscode-charts-orange, #e8a838);
  }

  .due-upcoming .due-badge {
    background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    color: var(--moments-muted);
    opacity: 0.75;
  }

  /* ---- Input area ---- */
  .input-area {
    flex-shrink: 0;
    padding: 10px var(--moments-inline-padding) 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--moments-border) 60%, transparent);
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .input-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: color-mix(in srgb, var(--vscode-input-background) 95%, transparent);
    border: 1px solid color-mix(in srgb, var(--vscode-input-border, var(--moments-border)) 80%, transparent);
    border-radius: 8px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .input-container:focus-within {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-input-background);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent);
    outline: none;
  }

  textarea {
    display: block;
    width: 100%;
    resize: none;
    background: transparent;
    color: var(--vscode-input-foreground);
    border: none;
    padding: 10px 12px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.45;
    outline: none;
    min-height: 38px;
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
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    color: var(--moments-muted);
    cursor: pointer;
    border-radius: 6px;
    padding: 0;
    transition: all 0.2s ease;
  }

  .send-icon-btn:hover {
    color: var(--moments-accent);
    background: color-mix(in srgb, var(--moments-accent) 12%, transparent);
    transform: translateY(-0.5px);
  }

  .send-icon-btn svg {
    width: 14px;
    height: 14px;
    stroke-width: 2.2;
  }

  .send-icon-btn:active {
    background: var(--vscode-toolbar-activeBackground, rgba(90, 93, 94, 0.5));
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
    fill: var(--moments-muted);
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
    color: var(--moments-muted);
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
    min-height: 28px;
    min-width: 0;
    max-width: 40%;
    border: 1px solid color-mix(in srgb, var(--moments-accent) 35%, var(--moments-border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--moments-accent) 12%, transparent);
    color: var(--moments-accent);
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
    background: color-mix(in srgb, var(--moments-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--moments-accent) 50%, var(--moments-border));
  }

  /* ---- Export select mode ---- */
  .export-btn.active {
    opacity: 1;
    color: var(--moments-accent);
    background: color-mix(in srgb, var(--moments-accent) 12%, transparent);
    border-radius: 4px;
  }

  .select-entry-cb {
    display: none;
    flex: none;
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--moments-accent);
    cursor: pointer;
    margin-top: 1px;
  }

  body.select-mode .select-entry-cb {
    display: block;
  }

  .entry.selected-for-export {
    background: color-mix(in srgb, var(--moments-accent) 10%, var(--vscode-editor-background));
    border-color: color-mix(in srgb, var(--moments-accent) 30%, var(--moments-border));
  }

  .export-action-bar {
    flex-shrink: 0;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px var(--moments-inline-padding);
    border-top: 1px solid var(--vscode-focusBorder, var(--moments-border));
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  }

  body.select-mode .export-action-bar {
    display: flex;
  }

  .selected-count-label {
    flex: 1;
    font-size: 11px;
    color: var(--moments-muted);
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
    border-bottom: 2px solid var(--moments-accent);
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
    border-bottom: 1px solid var(--moments-border);
  }

  .pinned-section-label {
    color: var(--moments-accent);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }

  .pinned-entry {
    background: color-mix(in srgb, var(--moments-accent) 6%, var(--vscode-editor-background));
    border-color: color-mix(in srgb, var(--moments-accent) 40%, transparent);
  }
  .pinned-entry:hover { background: color-mix(in srgb, var(--moments-accent) 12%, var(--vscode-list-hoverBackground)); }

  .pin-btn.pinned { opacity: 1; color: var(--moments-accent); }
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
      </button>
      <button class="nav-btn" id="inboxBtn" title="Task inbox" aria-label="Task inbox">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
      </button>
      <button class="open-btn" id="openFileBtn" title="Open today's file" aria-label="Open today's file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </button>
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
    html = html.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" style="color:var(--moments-accent)">$1</a>');
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
        saveButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"></polyline></svg>';
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
        cancelButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
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
      editButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
      editButton.addEventListener('click', () => {
        editingEntryKey = entryKey;
        editingText = entry.text;
        renderTimeline(latestSections);
      });

      const deleteButton = document.createElement('button');
      deleteButton.className = 'entry-action danger';
      deleteButton.type = 'button';
      deleteButton.title = 'Delete';
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
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
      pinButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="18" y1="8" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="6"></line><path d="M12 6H8a2 2 0 0 0-2 2v3.586a1 1 0 0 1-.293.707l-2.828 2.828a1 1 0 0 0 0 1.414L6 19.5a1 1 0 0 0 1.414 0l2.828-2.828a1 1 0 0 1 .707-.293H15a2 2 0 0 0 2-2V8"></path></svg>';
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
  inboxBtn.addEventListener('click', () => vscode.postMessage({ command: 'openInbox' }));
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
