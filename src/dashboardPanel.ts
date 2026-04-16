import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { buildDashboardLoadingHtml, buildDashboardPanelHtml } from "./dashboardPanelHtml.js";
import { getMomentsSubfolderSetting } from "./notesConfig.js";
import {
  extractTasksFromTextWithStatus,
  extractTasksFromNotes,
  listCopilotModels,
  type ExtractedTask,
  type ExtractTasksFailureReason,
  type NoteContent,
  type ExtractedTaskWithSource,
} from "./aiTaskProcessor.js";
export type {
  DashTask,
  WeekDay,
  DismissedExtractedTask,
  DashboardCandidateTask,
  ExtractedTaskFilterResult,
  DashboardTaskSection,
  DashboardListFilter,
  DashboardTaskView,
  DashboardCandidateView,
  DashboardListItem,
  DashboardListSectionView,
  DashboardListViewModel,
  DashboardCandidateStateMigration,
  DashboardCandidateAddAck,
  DashboardSummary,
  DashboardData,
} from "./dashboardTypes.js";
import type {
  DashboardCandidateAddAck,
  DashboardData,
  DashboardListFilter,
  DashboardTaskView,
  DismissedExtractedTask,
} from "./dashboardTypes.js";
import {
  canAddDashboardCandidate,
  normalizeOptionalDate,
  todayDateString,
  normalizeDashboardTaskText,
  normalizeExtractedTaskIdentity,
  stripDashboardDueDate,
  upsertDashboardDueDate,
  resolveDashboardTaskFile,
  ensureDashboardTaskFile,
  resolveTaskRef,
  buildTaskMarkdownLine,
  shiftDate,
  normalizeDismissedExtractedTasks,
  pruneDismissedExtractedTasks,
  filterExtractedTasksForDisplay,
  buildExtractedTaskStatusMessage,
  buildExtractedTaskFailureMessage,
  TASK_RE,
} from "./dashboardTaskUtils.js";
export {
  canAddDashboardCandidate,
  todayDateString,
  normalizeDashboardTaskText,
  normalizeExtractedTaskIdentity,
  stripDashboardDueDate,
  upsertDashboardDueDate,
  resolveDashboardTaskFile,
  filterExtractedTasksForDisplay,
} from "./dashboardTaskUtils.js";
export { collectTasksFromNotes } from "./dashboardTaskCollector.js";
export {
  buildUpcomingWeek,
  classifyDashboardTask,
  buildDashboardTaskViews,
  buildDashboardCandidateViews,
} from "./dashboardClassification.js";
export {
  buildDashboardListItems,
  matchesDashboardListItemFilter,
  countDashboardListItemsForFilter,
  buildDashboardListViewModel,
} from "./dashboardListViewModel.js";
export { migrateDashboardCandidateState } from "./dashboardCandidateMigration.js";

import { buildSectionCounts, buildCategoryCounts, buildSummary } from "./dashboardAnalytics.js";
import { collectTasksFromNotes } from "./dashboardTaskCollector.js";
import {
  buildUpcomingWeek,
  buildDashboardTaskViews,
  buildDashboardCandidateViews,
} from "./dashboardClassification.js";
import {
  buildDashboardListItems,
  matchesDashboardListItemFilter,
  countDashboardListItemsForFilter,
  buildDashboardListViewModel,
} from "./dashboardListViewModel.js";
import { migrateDashboardCandidateState } from "./dashboardCandidateMigration.js";

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
    void DashboardPanel._instance?._update();
  }

  static dispose(): void {
    DashboardPanel._instance?.dispose();
  }

  static setStatusListener(cb: (processing: boolean) => void): void {
    DashboardPanel._statusListener = cb;
  }

  static runAiExtract(fromDate?: string, toDate?: string): void {
    if (DashboardPanel._instance) {
      const today = todayDateString();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const defaultFromDate = sevenDaysAgo.toISOString().split("T")[0];
      void DashboardPanel._instance._runAiExtract(fromDate || defaultFromDate, toDate || today);
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

    void this._update();
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

  private async _update(): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      this._panel.webview.html = this._getLoadingHtml(
        "Notes directory is not configured. Run Setup first.",
      );
      return;
    }

    const momentsSubfolder = getMomentsSubfolderSetting();

    const tasks = await collectTasksFromNotes(notesDir, momentsSubfolder);
    const today = todayDateString();
    const week = buildUpcomingWeek(tasks, today);

    const taskViews = buildDashboardTaskViews(tasks, today);
    const sectionCounts = buildSectionCounts(taskViews);
    const catCount = buildCategoryCounts(taskViews);
    const summary = buildSummary(taskViews, sectionCounts);
    const availableModels = await listCopilotModels();

    this._panel.webview.html = this._getHtml({
      today,
      tasks: taskViews,
      week,
      catCount,
      sectionCounts,
      summary,
      availableModels: availableModels.map((m) => ({ id: m.id, name: m.name })),
    });
  }

  private async _handleMessage(message: Record<string, unknown>): Promise<void> {
    switch (message.command) {
      case "refresh":
        void this._update();
        return;

      case "toggleTask": {
        if (typeof message.taskId !== "string" || typeof message.done !== "boolean") {
          return;
        }
        void this._toggleTask(message.taskId, message.done);
        return;
      }

      case "openFile": {
        if (typeof message.filePath !== "string" || typeof message.lineIndex !== "number") {
          return;
        }
        void this._openFile(message.filePath, message.lineIndex);
        return;
      }

      case "createTask": {
        if (typeof message.text !== "string") {
          return;
        }
        void this._createTask(
          message.text,
          normalizeOptionalDate(message.targetDate as string | null | undefined),
          normalizeOptionalDate(message.dueDate as string | null | undefined),
        );
        return;
      }

      case "addExtractedTask": {
        if (typeof message.text !== "string") {
          return;
        }
        void this._addExtractedTask({
          text: message.text,
          targetDate: normalizeOptionalDate(message.targetDate as string | null | undefined),
          dueDate: normalizeOptionalDate(message.dueDate as string | null | undefined),
          requestId: typeof message.requestId === "string" ? message.requestId : null,
        });
        return;
      }

      case "updateTask": {
        if (typeof message.taskId !== "string" || typeof message.text !== "string") {
          return;
        }
        void this._updateTask(
          message.taskId,
          message.text,
          normalizeOptionalDate(message.dueDate as string | null | undefined),
        );
        return;
      }

      case "dismissExtractedTask": {
        if (typeof message.text === "string") {
          this._dismissExtractedTask(message.text);
        }
        return;
      }

      case "deleteTask": {
        if (typeof message.taskId !== "string") {
          return;
        }
        void this._deleteTask(message.taskId);
        return;
      }

      case "aiExtract": {
        if (typeof message.fromDate !== "string" || typeof message.toDate !== "string") {
          return;
        }
        void this._runAiExtract(
          message.fromDate,
          message.toDate,
          typeof message.modelId === "string" ? message.modelId : undefined,
        );
        return;
      }

      case "extractFromNotes": {
        if (typeof message.fromDate !== "string" || typeof message.toDate !== "string") {
          return;
        }
        void this._extractFromNotes(
          message.fromDate,
          message.toDate,
          typeof message.modelId === "string" ? message.modelId : undefined,
        );
        return;
      }
    }
  }

  private async _toggleTask(taskId: string, done: boolean): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const ref = resolveTaskRef(notesDir, taskId);
    if (!ref) {
      return;
    }

    try {
      await fs.access(ref.filePath);
    } catch {
      return;
    }

    const lines = (await fs.readFile(ref.filePath, "utf8")).split("\n");
    const line = lines[ref.lineIndex];
    if (!line) {
      return;
    }

    const match = TASK_RE.exec(line);
    if (!match) {
      return;
    }

    lines[ref.lineIndex] = buildTaskMarkdownLine(done, match[2].trim());
    await fs.writeFile(ref.filePath, lines.join("\n"), "utf8");
    void this._update();
  }

  private async _updateTask(taskId: string, text: string, dueDate: string | null): Promise<void> {
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
    if (!ref) {
      return;
    }

    try {
      await fs.access(ref.filePath);
    } catch {
      return;
    }

    const lines = (await fs.readFile(ref.filePath, "utf8")).split("\n");
    const line = lines[ref.lineIndex];
    if (!line) {
      return;
    }

    const match = TASK_RE.exec(line);
    if (!match) {
      return;
    }

    lines[ref.lineIndex] = buildTaskMarkdownLine(match[1].toLowerCase() === "x", normalizedText);
    await fs.writeFile(ref.filePath, lines.join("\n"), "utf8");
    void this._update();
  }

  private async _deleteTask(taskId: string): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const ref = resolveTaskRef(notesDir, taskId);
    if (!ref) {
      return;
    }

    try {
      await fs.access(ref.filePath);
    } catch {
      return;
    }

    const lines = (await fs.readFile(ref.filePath, "utf8")).split("\n");
    const line = lines[ref.lineIndex];
    if (!line || !TASK_RE.exec(line)) {
      return;
    }

    lines.splice(ref.lineIndex, 1);
    await fs.writeFile(ref.filePath, lines.join("\n"), "utf8");
    void this._update();
  }

  private async _createTask(
    text: string,
    targetDate: string | null,
    dueDate: string | null,
  ): Promise<boolean> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return false;
    }

    const normalizedText = upsertDashboardDueDate(text, dueDate);
    if (!normalizedText) {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return false;
    }

    const taskFile = await ensureDashboardTaskFile(notesDir, targetDate);
    const existing = await fs.readFile(taskFile, "utf8");
    const prefix = existing.endsWith("\n") ? "" : "\n";
    await fs.writeFile(
      taskFile,
      `${existing}${prefix}${buildTaskMarkdownLine(false, normalizedText)}\n`,
      "utf8",
    );

    void this._update();
    return true;
  }

  private async _hasExistingExtractedTask(notesDir: string, text: string): Promise<boolean> {
    const targetKey = normalizeExtractedTaskIdentity(text);
    if (!targetKey) {
      return false;
    }

    const tasks = await collectTasksFromNotes(notesDir);
    return tasks.some((task) => normalizeExtractedTaskIdentity(task.text) === targetKey);
  }

  private async _addExtractedTask({
    text,
    targetDate,
    dueDate,
    requestId,
  }: {
    text: string;
    targetDate: string | null;
    dueDate: string | null;
    requestId: string | null;
  }): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      this._postCandidateAddFailed(requestId, "Notes directory is not configured.");
      return;
    }

    if (await this._hasExistingExtractedTask(notesDir, text)) {
      void this._update();
      this._postCandidateAddResult({ requestId, status: "exists" });
      return;
    }

    try {
      const created = await this._createTask(text, targetDate, dueDate);
      if (!created) {
        this._postCandidateAddFailed(requestId, "Task text cannot be empty.");
        return;
      }

      this._postCandidateAddResult({ requestId, status: "added" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add candidate task.";
      void vscode.window.showErrorMessage(message);
      this._postCandidateAddFailed(requestId, message);
    }
  }

  private _postCandidateAddResult(result: DashboardCandidateAddAck): void {
    void this._panel.webview.postMessage({
      type: "candidateAddResult",
      requestId: result.requestId,
      status: result.status,
    });
  }

  private _postCandidateAddFailed(requestId: string | null, message: string): void {
    void this._panel.webview.postMessage({
      type: "candidateAddFailed",
      requestId,
      message,
    });
  }

  private async _openFile(filePath: string, lineIndex: number): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      return;
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    const position = new vscode.Position(lineIndex, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }

  private async _runAiExtract(fromDate: string, toDate: string, modelId?: string): Promise<void> {
    this._cancelToken?.cancel();
    this._cancelToken = new vscode.CancellationTokenSource();
    const token = this._cancelToken.token;

    DashboardPanel._statusListener?.(true);
    void this._panel.webview.postMessage({
      type: "aiStatus",
      status: "processing",
      message: `${fromDate} ～ ${toDate} の Moments を分析しています...`,
    });

    try {
      const notesDir = this._getNotesDir();
      if (!notesDir) {
        return;
      }

      const momentsSubfolder = getMomentsSubfolderSetting();

      // Collect content from all dates in the range
      const allCleanTexts: string[] = [];
      const datesWithContent: string[] = [];
      const startDate = new Date(fromDate);
      const endDate = new Date(toDate);

      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const momentsFile = path.join(notesDir, momentsSubfolder, `${dateStr}.md`);

        let fileExists = false;
        try {
          await fs.access(momentsFile);
          fileExists = true;
        } catch {
          /* not found */
        }

        if (fileExists) {
          const content = await fs.readFile(momentsFile, "utf8");
          const body = content.replace(/^---[\s\S]*?---\s*/m, "").trim();
          const cleanText = body
            .split("\n")
            .filter((line) => line.startsWith("- "))
            .map((line) => line.replace(/^- (\d{2}:\d{2} )?/, "").trim())
            .filter(Boolean)
            .join("\n");

          if (cleanText) {
            allCleanTexts.push(`[${dateStr}]\n${cleanText}`);
            datesWithContent.push(dateStr);
          }
        }
      }

      if (allCleanTexts.length === 0) {
        void this._panel.webview.postMessage({
          type: "aiStatus",
          status: "error",
          message: `${fromDate} ～ ${toDate} の期間に該当する Moments が見つかりません。`,
        });
        return;
      }

      const combinedText = allCleanTexts.join("\n\n");
      const extractionResult = await extractTasksFromTextWithStatus(combinedText, token, modelId);
      const extracted = extractionResult.tasks;
      const existingTasks = await collectTasksFromNotes(notesDir, momentsSubfolder);
      const filtered = filterExtractedTasksForDisplay(
        extracted,
        existingTasks,
        this._loadDismissedExtractedTasks(notesDir),
      );

      if (filtered.visibleTasks.length === 0) {
        void this._panel.webview.postMessage({
          type: "aiStatus",
          status: "done",
          message:
            extractionResult.failureReason !== null
              ? buildExtractedTaskFailureMessage(extractionResult.failureReason)
              : buildExtractedTaskStatusMessage(filtered),
        });
        return;
      }

      void this._panel.webview.postMessage({
        type: "aiStatus",
        status: "done",
        message: `${datesWithContent.length}日分の Moments から${filtered.visibleTasks.length}件のタスク候補を抽出しました。`,
      });
      void this._panel.webview.postMessage({ type: "extractResult", tasks: filtered.visibleTasks });
    } finally {
      DashboardPanel._statusListener?.(false);
    }
  }

  private async _extractFromNotes(
    fromDate: string,
    toDate: string,
    modelId?: string,
  ): Promise<void> {
    this._cancelToken?.cancel();
    this._cancelToken = new vscode.CancellationTokenSource();
    const token = this._cancelToken.token;

    DashboardPanel._statusListener?.(true);
    void this._panel.webview.postMessage({
      type: "notesAiStatus",
      status: "processing",
      message: `${fromDate} ～ ${toDate} のノートを分析しています...`,
    });

    try {
      const notesDir = this._getNotesDir();
      if (!notesDir) {
        return;
      }

      // Collect notes by date using direct file reading (fallback method)
      const noteContents = await this._collectNotesByDate(fromDate, toDate);

      if (noteContents.length === 0) {
        void this._panel.webview.postMessage({
          type: "notesAiStatus",
          status: "error",
          message: `${fromDate} ～ ${toDate} の期間に該当するノートが見つかりません。`,
        });
        return;
      }

      const momentsSubfolder = getMomentsSubfolderSetting();
      const extracted = await extractTasksFromNotes(noteContents, token, modelId);
      const existingTasks = await collectTasksFromNotes(notesDir, momentsSubfolder);
      const filtered = filterExtractedTasksForDisplay(
        extracted,
        existingTasks,
        this._loadDismissedExtractedTasks(notesDir),
      );

      if (filtered.visibleTasks.length === 0) {
        void this._panel.webview.postMessage({
          type: "notesAiStatus",
          status: "done",
          message: buildExtractedTaskStatusMessage(filtered),
        });
        return;
      }

      void this._panel.webview.postMessage({
        type: "notesAiStatus",
        status: "done",
        message: `${noteContents.length}件のノートから${filtered.visibleTasks.length}件のタスク候補を抽出しました。`,
      });
      void this._panel.webview.postMessage({
        type: "notesExtractResult",
        tasks: filtered.visibleTasks,
      });
    } finally {
      DashboardPanel._statusListener?.(false);
    }
  }

  private async _collectNotesByDate(fromDate: string, toDate: string): Promise<NoteContent[]> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return [];
    }

    const results: NoteContent[] = [];

    const collectFiles = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "moments") {
            await collectFiles(fullPath);
          }
        } else if (entry.name.endsWith(".md")) {
          const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const fileDate = dateMatch[1];
            if (fileDate >= fromDate && fileDate <= toDate) {
              try {
                const content = await fs.readFile(fullPath, "utf8");
                results.push({
                  filename: path.relative(notesDir, fullPath),
                  title: entry.name.replace(/\.md$/, ""),
                  content,
                  createdAt: fileDate,
                });
              } catch (e) {
                // Skip files that can't be read
              }
            }
          }
        }
      }
    };

    await collectFiles(notesDir);
    return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  private _getLoadingHtml(message: string): string {
    return buildDashboardLoadingHtml(message);
  }

  private _getHtml(data: DashboardData): string {
    return buildDashboardPanelHtml(data);
  }
}
