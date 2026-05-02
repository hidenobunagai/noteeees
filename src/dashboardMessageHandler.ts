import * as fs from "fs/promises";
import * as vscode from "vscode";
import {
  extractDashboardMomentsCandidates,
  extractDashboardNotesCandidates,
} from "./dashboardExtraction.js";
import {
  createDashboardTask,
  deleteDashboardTask,
  hasExistingDashboardTask,
  toggleDashboardTask,
  updateDashboardTask,
} from "./dashboardTaskPersistence.js";
import { normalizeOptionalDate } from "./dashboardTaskUtils.js";
import type { DashboardCandidateAddAck } from "./dashboardTypes.js";
import { getMomentsSubfolderSetting } from "./notesConfig.js";

export interface DashboardMessageHandlerDeps {
  getNotesDir: () => string | undefined;
  stateStore: vscode.Memento;
  /** Called after any mutation that should refresh the webview. */
  onRefresh: () => Promise<void>;
  /** Posts a message to the webview. */
  postMessage: (message: Record<string, unknown>) => Thenable<boolean>;
  /** Returns the current cancellation token source. */
  getCancelToken: () => vscode.CancellationTokenSource | undefined;
  /** Sets a new cancellation token source. */
  setCancelToken: (cts: vscode.CancellationTokenSource | undefined) => void;
  /** Called to notify external listeners that an AI extraction is running / finished. */
  notifyStatus: (processing: boolean) => void;
  /** Dismisses an extracted task from the store. */
  dismissExtractedTaskInStore: (notesDir: string, text: string) => void;
  /** Loads dismissed extracted tasks from the store. */
  loadDismissed: () => ReturnType<
    typeof import("./dashboardDismissedTasks.js").loadDismissedExtractedTasks
  >;
  /** Optional test hook for task creation persistence. */
  createTask?: typeof createDashboardTask;
  /** Optional test hook for duplicate detection. */
  hasExistingTask?: typeof hasExistingDashboardTask;
}

export function createDashboardMessageHandler(deps: DashboardMessageHandlerDeps) {
  function _dismissExtractedTask(text: string): void {
    const notesDir = deps.getNotesDir();
    if (!notesDir) {
      return;
    }
    deps.dismissExtractedTaskInStore(notesDir, text);
  }

  function _postCandidateAddResult(result: DashboardCandidateAddAck): void {
    void deps.postMessage({
      type: "candidateAddResult",
      requestId: result.requestId,
      status: result.status,
    });
  }

  function _postCandidateAddFailed(requestId: string | null, message: string): void {
    void deps.postMessage({
      type: "candidateAddFailed",
      requestId,
      message,
    });
  }

  async function _toggleTask(taskId: string, done: boolean): Promise<void> {
    const notesDir = deps.getNotesDir();
    if (!notesDir) {
      return;
    }

    if (await toggleDashboardTask(notesDir, taskId, done)) {
      void deps.onRefresh();
    }
  }

  async function _updateTask(taskId: string, text: string, dueDate: string | null): Promise<void> {
    const notesDir = deps.getNotesDir();
    if (!notesDir) {
      return;
    }

    const result = await updateDashboardTask(notesDir, taskId, text, dueDate);
    if (result === "invalid-text") {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return;
    }

    if (result === "updated") {
      void deps.onRefresh();
    }
  }

  async function _deleteTask(taskId: string): Promise<void> {
    const notesDir = deps.getNotesDir();
    if (!notesDir) {
      return;
    }

    if (await deleteDashboardTask(notesDir, taskId)) {
      void deps.onRefresh();
    }
  }

  async function _createTask(
    text: string,
    targetDate: string | null,
    dueDate: string | null,
  ): Promise<boolean> {
    const notesDir = deps.getNotesDir();
    if (!notesDir) {
      return false;
    }

  const createTask = deps.createTask ?? createDashboardTask;
  const result = await createTask(notesDir, text, targetDate, dueDate);
    if (result === "invalid-text") {
      void vscode.window.showErrorMessage("Task text cannot be empty.");
      return false;
    }

    void deps.onRefresh();
    return true;
  }

  async function _hasExistingExtractedTask(notesDir: string, text: string): Promise<boolean> {
    const hasExistingTask = deps.hasExistingTask ?? hasExistingDashboardTask;
    return hasExistingTask(notesDir, text);
  }

  async function _addExtractedTask({
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
    const notesDir = deps.getNotesDir();
    if (!notesDir) {
      _postCandidateAddFailed(requestId, "Notes directory is not configured.");
      return;
    }

    if (await _hasExistingExtractedTask(notesDir, text)) {
      void deps.onRefresh();
      _postCandidateAddResult({ requestId, status: "exists" });
      return;
    }

    try {
      const created = await _createTask(text, targetDate, dueDate);
      if (!created) {
        _postCandidateAddFailed(requestId, "Task text cannot be empty.");
        return;
      }

      _postCandidateAddResult({ requestId, status: "added" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add candidate task.";
      void vscode.window.showErrorMessage(message);
      _postCandidateAddFailed(requestId, message);
    }
  }

  async function _openFile(filePath: string, lineIndex: number): Promise<void> {
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

  async function _runCandidateExtraction(options: {
    fromDate: string;
    toDate: string;
    modelId?: string;
    statusType: "aiStatus" | "notesAiStatus";
    resultType: "extractResult" | "notesExtractResult";
    processingMessage: string;
    extract: typeof extractDashboardMomentsCandidates | typeof extractDashboardNotesCandidates;
  }): Promise<void> {
    deps.getCancelToken()?.cancel();
    const cts = new vscode.CancellationTokenSource();
    deps.setCancelToken(cts);
    const token = cts.token;

    deps.notifyStatus(true);
    void deps.postMessage({
      type: options.statusType,
      status: "processing",
      message: options.processingMessage,
    });

    try {
      const notesDir = deps.getNotesDir();
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
        dismissedTasks: deps.loadDismissed(),
      });

      void deps.postMessage({
        type: options.statusType,
        status: result.status,
        message: result.message,
      });
      if (result.tasks.length > 0) {
        void deps.postMessage({
          type: options.resultType,
          tasks: result.tasks,
        });
      }
    } finally {
      deps.notifyStatus(false);
    }
  }

  async function _runAiExtract(fromDate: string, toDate: string, modelId?: string): Promise<void> {
    await _runCandidateExtraction({
      fromDate,
      toDate,
      modelId,
      statusType: "aiStatus",
      resultType: "extractResult",
      processingMessage: `${fromDate} ～ ${toDate} の Moments を分析しています...`,
      extract: extractDashboardMomentsCandidates,
    });
  }

  async function _extractFromNotes(
    fromDate: string,
    toDate: string,
    modelId?: string,
  ): Promise<void> {
    await _runCandidateExtraction({
      fromDate,
      toDate,
      modelId,
      statusType: "notesAiStatus",
      resultType: "notesExtractResult",
      processingMessage: `${fromDate} ～ ${toDate} のノートを分析しています...`,
      extract: extractDashboardNotesCandidates,
    });
  }

  async function handleMessage(message: Record<string, unknown>): Promise<void> {
    switch (message.command) {
      case "refresh":
        void deps.onRefresh();
        return;

      case "toggleTask": {
        if (typeof message.taskId !== "string" || typeof message.done !== "boolean") {
          return;
        }
        void _toggleTask(message.taskId, message.done);
        return;
      }

      case "openFile": {
        if (typeof message.filePath !== "string" || typeof message.lineIndex !== "number") {
          return;
        }
        void _openFile(message.filePath, message.lineIndex);
        return;
      }

      case "createTask": {
        if (typeof message.text !== "string") {
          return;
        }
        void _createTask(
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
        void _addExtractedTask({
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
        void _updateTask(
          message.taskId,
          message.text,
          normalizeOptionalDate(message.dueDate as string | null | undefined),
        );
        return;
      }

      case "dismissExtractedTask": {
        if (typeof message.text === "string") {
          _dismissExtractedTask(message.text);
        }
        return;
      }

      case "deleteTask": {
        if (typeof message.taskId !== "string") {
          return;
        }
        void _deleteTask(message.taskId);
        return;
      }

      case "aiExtract": {
        if (typeof message.fromDate !== "string" || typeof message.toDate !== "string") {
          return;
        }
        void _runAiExtract(
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
        void _extractFromNotes(
          message.fromDate,
          message.toDate,
          typeof message.modelId === "string" ? message.modelId : undefined,
        );
        return;
      }
    }
  }

  return { handleMessage };
}
