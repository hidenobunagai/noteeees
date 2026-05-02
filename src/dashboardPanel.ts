import * as vscode from "vscode";
import { listCopilotModels } from "./aiTaskProcessor.js";
import { loadDismissedExtractedTasks } from "./dashboardDismissedTasks.js";
import { buildDashboardLoadingHtml, buildDashboardPanelHtml } from "./dashboardPanelHtml.js";
import {
  createDashboardMessageHandler,
  type DashboardMessageHandlerDeps,
} from "./dashboardMessageHandler.js";
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
import { dismissExtractedTask as dismissExtractedTaskInStore } from "./dashboardDismissedTasks.js";

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
  private readonly _handleMessage: (message: Record<string, unknown>) => Promise<void>;
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
      void DashboardPanel._instance._handleMessage({
        command: "aiExtract",
        fromDate: fromDate || defaultFromDate,
        toDate: toDate || today,
      });
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

    const deps: DashboardMessageHandlerDeps = {
      getNotesDir: () => this._getNotesDir(),
      stateStore: this._stateStore,
      onRefresh: () => this._update(),
      postMessage: (msg) => this._panel.webview.postMessage(msg),
      getCancelToken: () => this._cancelToken,
      setCancelToken: (cts) => { this._cancelToken = cts; },
      notifyStatus: (processing) => DashboardPanel._statusListener?.(processing),
      dismissExtractedTaskInStore: (notesDir, text) =>
        dismissExtractedTaskInStore(this._stateStore, notesDir, text),
      loadDismissed: () => loadDismissedExtractedTasks(this._stateStore, this._getNotesDir()!),
    };

    const handler = createDashboardMessageHandler(deps);
    this._handleMessage = handler.handleMessage;

    this._panel.webview.options = { enableScripts: true };
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (message: unknown) => this._handleMessage(message as Record<string, unknown>),
      null,
      this._disposables,
    );

    void this._update();
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
