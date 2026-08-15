import * as fs from "fs/promises";
import * as vscode from "vscode";
import { DashboardPanel } from "./dashboardPanel.js";
import { isPathInside } from "./dashboardTaskUtils.js";
import { archiveMoments } from "./moments/fileIo.js";
import { showOpenTasksOverview } from "./moments/taskOverview.js";
import {
  createNewNote,
  listNotes,
  openDailyNote,
} from "./noteCommands";
import {
  getDailyNoteTemplateSetting,
  getMomentsArchiveAfterDaysSetting,
  getSidebarTagSortSetting,
  updateSidebarTagSortSetting,
} from "./notesConfig.js";
import { movePinnedItem, type SidebarTagSortMode } from "./sidebarProvider";
import { t } from "./i18n.js";

export interface NotesCommandDeps {
  getNotesDir(): string | undefined;
  ensureNotesDirectory(): Promise<string | undefined>;
  selectNotesDirectory(scope: "global" | "workspace"): Promise<string | undefined>;
  getPinnedRelativePaths(): string[];
  setPinnedRelativePaths(paths: string[]): Promise<void>;
  getSelectedSidebarItem(): (vscode.TreeItem & { relativePath?: string }) | undefined;
  refreshNotesTree(): void;
  refreshMoments(): void;
  refreshMarkdownWatcher(): void;
  searchTags(notesDir: string): Promise<void>;
}

/** Registers all `notes.*` commands and returns the disposables to push. */
export function registerNotesCommands(
  context: vscode.ExtensionContext,
  deps: NotesCommandDeps,
): vscode.Disposable[] {
  const {
    getNotesDir,
    ensureNotesDirectory,
    selectNotesDirectory,
    getPinnedRelativePaths,
    setPinnedRelativePaths,
    getSelectedSidebarItem,
    refreshNotesTree,
    refreshMoments,
    refreshMarkdownWatcher,
    searchTags,
  } = deps;

  // Run Setup command
  const runSetupDisposable = vscode.commands.registerCommand("notes.runSetup", async () => {
    const hasWorkspace =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
    let scope: "global" | "workspace" = "global";

    if (hasWorkspace) {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: t("globalScope"),
            description: t("globalScopeDesc"),
            value: "global" as const,
          },
          {
            label: t("workspaceScope"),
            description: t("workspaceScopeDesc"),
            value: "workspace" as const,
          },
        ],
        { placeHolder: t("setNotesDirFor") },
      );
      if (!choice) {
        return;
      }
      scope = choice.value;
    }

    const notesDir = await selectNotesDirectory(scope);
    if (notesDir) {
      refreshMarkdownWatcher();
      refreshNotesTree();
      const scopeLabel = scope === "workspace" ? t("workspaceScope") : t("globalScope");
      vscode.window.showInformationMessage(t("notesDirSet", { scope: scopeLabel, dir: notesDir }));
    }
  });

  // Refresh sidebar command
  const refreshDisposable = vscode.commands.registerCommand("notes.refreshSidebar", () => {
    refreshNotesTree();
  });

  const toggleTagSortDisposable = vscode.commands.registerCommand(
    "notes.toggleTagSort",
    async () => {
      const nextMode: SidebarTagSortMode =
        getSidebarTagSortSetting() === "frequency" ? "alphabetical" : "frequency";

      await updateSidebarTagSortSetting(nextMode, vscode.ConfigurationTarget.Global);

      refreshNotesTree();
      vscode.window.showInformationMessage(t("tagSortSet", { mode: nextMode }));
    },
  );

  const searchTagsDisposable = vscode.commands.registerCommand("notes.searchTags", async () => {
    const notesDir = await ensureNotesDirectory();
    if (!notesDir) {
      return;
    }

    await searchTags(notesDir);
  });

  // New Note command
  const newNoteDisposable = vscode.commands.registerCommand("notes.newNote", async () => {
    const notesDir = await ensureNotesDirectory();
    if (!notesDir) {
      return;
    }
    await createNewNote(notesDir);
    refreshNotesTree();
  });

  // List Notes command
  const listNotesDisposable = vscode.commands.registerCommand("notes.listNotes", async () => {
    const notesDir = await ensureNotesDirectory();
    if (!notesDir) {
      return;
    }
    await listNotes(notesDir);
  });

  // Focus Moments panel command
  const focusMomentsDisposable = vscode.commands.registerCommand("notes.focusMoments", async () => {
    await ensureNotesDirectory();
    await vscode.commands.executeCommand("notesMomentsView.focus");
  });

  const showOpenTasksOverviewDisposable = vscode.commands.registerCommand(
    "notes.showOpenTasksOverview",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) {
        return;
      }

      await showOpenTasksOverview(notesDir);
    },
  );

  // Open Note File command (used by sidebar)
  const openNoteFileDisposable = vscode.commands.registerCommand(
    "notes.openNoteFile",
    async (filePath: string) => {
      if (typeof filePath !== "string" || !filePath) {
        return;
      }
      const notesDir = getNotesDir();
      if (notesDir && !isPathInside(notesDir, filePath)) {
        return;
      }
      try {
        await fs.access(filePath);
      } catch {
        return;
      }
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    },
  );

  const pinNoteDisposable = vscode.commands.registerCommand(
    "notes.pinNote",
    async (item?: { relativePath?: string }) => {
      const relativePath = item?.relativePath;
      if (!relativePath) {
        return;
      }

      await setPinnedRelativePaths([...getPinnedRelativePaths(), relativePath]);
      refreshNotesTree();
    },
  );

  const unpinNoteDisposable = vscode.commands.registerCommand(
    "notes.unpinNote",
    async (item?: { relativePath?: string }) => {
      const relativePath = item?.relativePath;
      if (!relativePath) {
        return;
      }

      await setPinnedRelativePaths(
        getPinnedRelativePaths().filter((path) => path !== relativePath),
      );
      refreshNotesTree();
    },
  );

  const movePinnedNoteUpDisposable = vscode.commands.registerCommand(
    "notes.movePinnedNoteUp",
    async (item?: { relativePath?: string }) => {
      const relativePath = item?.relativePath ?? getSelectedSidebarItem()?.relativePath;
      if (!relativePath) {
        return;
      }

      const current = getPinnedRelativePaths();
      const index = current.indexOf(relativePath);
      await setPinnedRelativePaths(movePinnedItem(current, index, "up"));
      refreshNotesTree();
    },
  );

  const movePinnedNoteDownDisposable = vscode.commands.registerCommand(
    "notes.movePinnedNoteDown",
    async (item?: { relativePath?: string }) => {
      const relativePath = item?.relativePath ?? getSelectedSidebarItem()?.relativePath;
      if (!relativePath) {
        return;
      }

      const current = getPinnedRelativePaths();
      const index = current.indexOf(relativePath);
      await setPinnedRelativePaths(movePinnedItem(current, index, "down"));
      refreshNotesTree();
    },
  );

  // Open Daily Note command
  const openDailyNoteDisposable = vscode.commands.registerCommand(
    "notes.openDailyNote",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) {
        return;
      }

      const templatePath = getDailyNoteTemplateSetting();

      await openDailyNote(notesDir, templatePath);
      refreshNotesTree();
    },
  );

  const openDashboardDisposable = vscode.commands.registerCommand(
    "notes.openDashboard",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) {
        return;
      }
      await DashboardPanel.createOrShow(getNotesDir, context.globalState);
    },
  );

  const aiExtractTasksDisposable = vscode.commands.registerCommand(
    "notes.aiExtractTasks",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) {
        return;
      }
      await DashboardPanel.createOrShow(getNotesDir, context.globalState);
      DashboardPanel.runAiExtract();
    },
  );

  const archiveMomentsDisposable = vscode.commands.registerCommand(
    "notes.archiveMoments",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) {
        return;
      }

      const afterDays = getMomentsArchiveAfterDaysSetting();

      const confirm = await vscode.window.showWarningMessage(
        t("archiveConfirm", { days: afterDays }),
        t("archiveBtn"),
        t("cancelBtn"),
      );
      if (confirm !== t("archiveBtn")) {
        return;
      }

      const { archived, skipped } = await archiveMoments(notesDir);
      if (archived === 0) {
        vscode.window.showInformationMessage(t("noMomentsToArchive", { skipped }));
      } else {
        vscode.window.showInformationMessage(t("archivedMoments", { count: archived, skipped }));
        refreshMoments();
      }
    },
  );

  return [
    runSetupDisposable,
    refreshDisposable,
    toggleTagSortDisposable,
    searchTagsDisposable,
    newNoteDisposable,
    listNotesDisposable,
    focusMomentsDisposable,
    showOpenTasksOverviewDisposable,
    openNoteFileDisposable,
    pinNoteDisposable,
    unpinNoteDisposable,
    movePinnedNoteUpDisposable,
    movePinnedNoteDownDisposable,
    openDailyNoteDisposable,
    openDashboardDisposable,
    aiExtractTasksDisposable,
    archiveMomentsDisposable,
  ];
}
