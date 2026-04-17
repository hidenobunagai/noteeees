import * as fs from "fs/promises";
import * as vscode from "vscode";
import { listCopilotModels } from "./aiTaskProcessor.js";
import {
  dismissExtractedTask as dismissExtractedTaskInStore,
  loadDismissedExtractedTasks,
} from "./dashboardDismissedTasks.js";
import {
  extractDashboardMomentsCandidates,
  extractDashboardNotesCandidates,
} from "./dashboardExtraction.js";
import { buildDashboardLoadingHtml, buildDashboardPanelHtml } from "./dashboardPanelHtml.js";
import {
  createDashboardTask,
  deleteDashboardTask,
  hasExistingDashboardTask,
  toggleDashboardTask,
  updateDashboardTask,
} from "./dashboardTaskPersistence.js";
import { normalizeOptionalDate, todayDateString } from "./dashboardTaskUtils.js";
import type { DashboardCandidateAddAck, DashboardData } from "./dashboardTypes.js";
import { getMomentsSubfolderSetting } from "./notesConfig.js";
export { migrateDashboardCandidateState } from "./dashboardCandidateMigration.js";
export {
  buildDashboardCandidateViews,
  buildDashboardTaskViews,
  buildUpcomingWeek,
  classifyDashboardTask,
} from "./dashboardClassification.js";
export {
  buildDashboardListItems,
  buildDashboardListViewModel,
  countDashboardListItemsForFilter,
  matchesDashboardListItemFilter,
} from "./dashboardListViewModel.js";
export { collectTasksFromNotes } from "./dashboardTaskCollector.js";
export {
  canAddDashboardCandidate,
  filterExtractedTasksForDisplay,
  normalizeDashboardTaskText,
  normalizeExtractedTaskIdentity,
  resolveDashboardTaskFile,
  stripDashboardDueDate,
  todayDateString,
  upsertDashboardDueDate,
} from "./dashboardTaskUtils.js";
export type {
  DashboardCandidateAddAck,
  DashboardCandidateStateMigration,
  DashboardCandidateTask,
  DashboardCandidateView,
  DashboardData,
  DashboardListFilter,
  DashboardListItem,
  DashboardListSectionView,
  DashboardListViewModel,
  DashboardSummary,
  DashboardTaskSection,
  DashboardTaskView,
  DashTask,
  DismissedExtractedTask,
  ExtractedTaskFilterResult,
  WeekDay,
} from "./dashboardTypes.js";

import { buildCategoryCounts, buildSectionCounts, buildSummary } from "./dashboardAnalytics.js";
import { buildDashboardTaskViews, buildUpcomingWeek } from "./dashboardClassification.js";
import { collectTasksFromNotes } from "./dashboardTaskCollector.js";

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

  private _dismissExtractedTask(text: string): void {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }
    dismissExtractedTaskInStore(this._stateStore, notesDir, text);
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

    if (await toggleDashboardTask(notesDir, taskId, done)) {
      void this._update();
    }
  }

  private async _updateTask(taskId: string, text: string, dueDate: string | null): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    const result = await updateDashboardTask(notesDir, taskId, text, dueDate);
    if (result === "invalid-text") {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return;
    }

    if (result === "updated") {
      void this._update();
    }
  }

  private async _deleteTask(taskId: string): Promise<void> {
    const notesDir = this._getNotesDir();
    if (!notesDir) {
      return;
    }

    if (await deleteDashboardTask(notesDir, taskId)) {
      void this._update();
    }
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

    const result = await createDashboardTask(notesDir, text, targetDate, dueDate);
    if (result === "invalid-text") {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return false;
    }

    void this._update();
    return true;
  }

  private async _hasExistingExtractedTask(notesDir: string, text: string): Promise<boolean> {
    return hasExistingDashboardTask(notesDir, text);
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
    await this._runCandidateExtraction({
      fromDate,
      toDate,
      modelId,
      statusType: "aiStatus",
      resultType: "extractResult",
      processingMessage: `${fromDate} ～ ${toDate} の Moments を分析しています...`,
      extract: extractDashboardMomentsCandidates,
    });
  }

  private async _extractFromNotes(
    fromDate: string,
    toDate: string,
    modelId?: string,
  ): Promise<void> {
    await this._runCandidateExtraction({
      fromDate,
      toDate,
      modelId,
      statusType: "notesAiStatus",
      resultType: "notesExtractResult",
      processingMessage: `${fromDate} ～ ${toDate} のノートを分析しています...`,
      extract: extractDashboardNotesCandidates,
    });
  }

  private async _runCandidateExtraction(options: {
    fromDate: string;
    toDate: string;
    modelId?: string;
    statusType: "aiStatus" | "notesAiStatus";
    resultType: "extractResult" | "notesExtractResult";
    processingMessage: string;
    extract: typeof extractDashboardMomentsCandidates | typeof extractDashboardNotesCandidates;
  }): Promise<void> {
    this._cancelToken?.cancel();
    this._cancelToken = new vscode.CancellationTokenSource();
    const token = this._cancelToken.token;

    DashboardPanel._statusListener?.(true);
    void this._panel.webview.postMessage({
      type: options.statusType,
      status: "processing",
      message: options.processingMessage,
    });

    try {
      const notesDir = this._getNotesDir();
      if (!notesDir) {
        return;
      }

      const result = await options.extract({
        notesDir,
        momentsSubfolder: getMomentsSubfolderSetting(),
        fromDate: options.fromDate,
        toDate: options.toDate,
        token,
        modelId: options.modelId,
        dismissedTasks: loadDismissedExtractedTasks(this._stateStore, notesDir),
      });

      void this._panel.webview.postMessage({
        type: options.statusType,
        status: result.status,
        message: result.message,
      });
      if (result.tasks.length > 0) {
        void this._panel.webview.postMessage({
          type: options.resultType,
          tasks: result.tasks,
        });
      }
    } finally {
      DashboardPanel._statusListener?.(false);
    }
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
