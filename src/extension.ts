import * as fs from "fs";
import * as vscode from "vscode";
import { createTaskFileWatcher } from "./aiTaskIndexer";
import { DashboardPanel } from "./dashboardPanel";
import { archiveMoments, MomentsViewProvider, showOpenTasksOverview } from "./momentsPanel";
import {
  buildIndexedNotes,
  collectNoteFiles,
  createNewNote,
  type IndexedNote,
  listNotes,
  openDailyNote,
  pickIndexedNote,
} from "./noteCommands";
import {
  buildSidebarTagGroups,
  movePinnedItem,
  NotesTreeProvider,
  type SidebarTagSortMode,
} from "./sidebarProvider";
import {
  BacklinksProvider,
  WikiLinkCompletionProvider,
  WikiLinkDefinitionProvider,
  WikiLinkDocumentLinkProvider,
} from "./wikiLinks";

const NOTES_DIRECTORY_STORAGE_KEY = "notesDirectory";
const PINNED_NOTES_KEY = "pinnedNotes";
const WORKSPACE_NOTES_DIRECTORY_KEY = "workspaceNotesDirectory";

export function resolveNotesDirectory(
  stored: string | undefined,
  configured: string | undefined,
  workspaceSetting: string | undefined,
): string | undefined {
  return workspaceSetting || stored || configured || undefined;
}

export function createNotesWatcherPattern(
  notesDir: string | undefined,
): vscode.GlobPattern | undefined {
  if (!notesDir) {
    return undefined;
  }

  return new vscode.RelativePattern(notesDir, "**/*.md");
}

export function buildTagSearchItems(
  indexedNotes: IndexedNote[],
  sortMode: SidebarTagSortMode,
): vscode.QuickPickItem[] {
  const summary = buildSidebarTagGroups(
    indexedNotes.map((note) => ({
      tags: note.metadata.tags,
      title: note.metadata.title,
      relativePath: note.relativePath,
      mtime: note.mtime,
    })),
    sortMode,
  );

  return summary.map(({ tag, count, latestTitle, latestMtime, latestRelativePath }) => {
    return {
      label: tag,
      description: `${count} note${count === 1 ? "" : "s"}`,
      detail:
        latestTitle && typeof latestMtime === "number"
          ? `Latest: ${latestTitle} • ${new Date(latestMtime).toLocaleDateString()}${latestRelativePath ? ` • ${latestRelativePath}` : ""}`
          : undefined,
    };
  });
}

export function activate(context: vscode.ExtensionContext) {
  function getConfiguredNotesDir(): string | undefined {
    const configured = vscode.workspace.getConfiguration("notes").get<string>("notesDirectory");
    return configured || undefined;
  }

  function getWorkspaceNotesDir(): string | undefined {
    const workspaceConfig = vscode.workspace
      .getConfiguration("notes")
      .get<string>(WORKSPACE_NOTES_DIRECTORY_KEY);
    return workspaceConfig || undefined;
  }

  function getNotesDir(): string | undefined {
    return resolveNotesDirectory(
      context.globalState.get<string>(NOTES_DIRECTORY_STORAGE_KEY),
      getConfiguredNotesDir(),
      getWorkspaceNotesDir(),
    );
  }

  async function setNotesDir(
    notesDir: string,
    scope: "global" | "workspace" = "global",
  ): Promise<void> {
    if (scope === "workspace") {
      await vscode.workspace
        .getConfiguration("notes")
        .update(WORKSPACE_NOTES_DIRECTORY_KEY, notesDir, vscode.ConfigurationTarget.Workspace);
      return;
    }

    await context.globalState.update(NOTES_DIRECTORY_STORAGE_KEY, notesDir);

    if (getConfiguredNotesDir()) {
      await vscode.workspace
        .getConfiguration("notes")
        .update("notesDirectory", undefined, vscode.ConfigurationTarget.Global);
    }
  }

  function getPinnedRelativePaths(): string[] {
    return context.globalState.get<string[]>(PINNED_NOTES_KEY) ?? [];
  }

  async function setPinnedRelativePaths(paths: string[]): Promise<void> {
    await context.globalState.update(PINNED_NOTES_KEY, [...new Set(paths)]);
  }

  function getSidebarTagSort(): SidebarTagSortMode {
    return (
      vscode.workspace.getConfiguration("notes").get<SidebarTagSortMode>("sidebarTagSort") ??
      "frequency"
    );
  }

  async function migrateNotesDirectoryStorage(): Promise<void> {
    const stored = context.globalState.get<string>(NOTES_DIRECTORY_STORAGE_KEY);
    const configured = getConfiguredNotesDir();

    if (!stored && configured) {
      await setNotesDir(configured);
      return;
    }

    if (stored && configured) {
      await vscode.workspace
        .getConfiguration("notes")
        .update("notesDirectory", undefined, vscode.ConfigurationTarget.Global);
    }
  }

  async function selectNotesDirectory(
    scope: "global" | "workspace" = "global",
  ): Promise<string | undefined> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select Notes Directory",
    });

    if (selected && selected[0]) {
      const notesDir = selected[0].fsPath;
      await setNotesDir(notesDir, scope);
      return notesDir;
    }
    return undefined;
  }

  async function ensureNotesDirectory(): Promise<string | undefined> {
    let notesDir = getNotesDir();
    if (!notesDir) {
      notesDir = await selectNotesDirectory();
      if (!notesDir) {
        vscode.window.showErrorMessage(
          "Notes directory is not configured. Run 'Notes: Run Setup' first.",
        );
        return undefined;
      }
    }
    return notesDir;
  }

  function getIndexedNotes(notesDir: string) {
    const momentsSubfolder =
      vscode.workspace.getConfiguration("notes").get<string>("momentsSubfolder") || "moments";
    const noteFiles = collectNoteFiles(notesDir, notesDir, [momentsSubfolder]);
    return buildIndexedNotes(noteFiles).sort((a, b) => b.mtime - a.mtime);
  }

  async function searchTags(notesDir: string): Promise<void> {
    const indexedNotes = getIndexedNotes(notesDir);
    const tagItems = buildTagSearchItems(indexedNotes, getSidebarTagSort());

    if (tagItems.length === 0) {
      vscode.window.showInformationMessage("No tags found.");
      return;
    }

    const selectedTag = await vscode.window.showQuickPick(tagItems, {
      placeHolder: "Search tags",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selectedTag) {
      return;
    }

    const matchingNotes = indexedNotes.filter((note) =>
      note.metadata.tags.includes(selectedTag.label),
    );
    const selectedNote = await pickIndexedNote(matchingNotes, `Notes tagged ${selectedTag.label}`);

    if (!selectedNote) {
      return;
    }

    if (typeof selectedNote === "string") {
      await createNewNote(notesDir, selectedNote);
    } else {
      const doc = await vscode.workspace.openTextDocument(selectedNote.absolutePath);
      await vscode.window.showTextDocument(doc);
    }
  }

  // Register sidebar tree view
  const notesTreeProvider = new NotesTreeProvider(
    getNotesDir,
    getPinnedRelativePaths,
    getSidebarTagSort,
  );
  const notesTreeView = vscode.window.createTreeView("notesExplorer", {
    treeDataProvider: notesTreeProvider as vscode.TreeDataProvider<vscode.TreeItem>,
  });
  let selectedSidebarItem: (vscode.TreeItem & { relativePath?: string }) | undefined;
  const treeSelectionDisposable = notesTreeView.onDidChangeSelection((event) => {
    selectedSidebarItem = event.selection[0] as
      | (vscode.TreeItem & { relativePath?: string })
      | undefined;
  });
  context.subscriptions.push(notesTreeView, treeSelectionDisposable);

  // Register Moments webview view
  const momentsProvider = new MomentsViewProvider(getNotesDir, context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MomentsViewProvider.viewType, momentsProvider),
  );

  // Register wiki-link language providers
  const markdownSelector: vscode.DocumentSelector = { language: "markdown", scheme: "*" };
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      markdownSelector,
      new WikiLinkDocumentLinkProvider(getNotesDir),
    ),
    vscode.languages.registerCompletionItemProvider(
      markdownSelector,
      new WikiLinkCompletionProvider(getNotesDir),
      "[",
    ),
    vscode.languages.registerDefinitionProvider(
      markdownSelector,
      new WikiLinkDefinitionProvider(getNotesDir),
    ),
  );

  // Register backlinks tree view
  const backlinksProvider = new BacklinksProvider(getNotesDir);
  vscode.window.registerTreeDataProvider("notesBacklinks", backlinksProvider);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => backlinksProvider.refresh()),
  );

  void migrateNotesDirectoryStorage().then(() => {
    notesTreeProvider.refresh();
    momentsProvider.refresh();
  });

  let mdWatcher: vscode.FileSystemWatcher | undefined;
  const refreshNotesViews = () => {
    notesTreeProvider.refresh();
    momentsProvider.refresh();
  };

  const refreshMarkdownWatcher = () => {
    mdWatcher?.dispose();
    mdWatcher = undefined;

    const pattern = createNotesWatcherPattern(getNotesDir());
    if (!pattern) {
      return;
    }

    mdWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    mdWatcher.onDidCreate(refreshNotesViews);
    mdWatcher.onDidDelete(refreshNotesViews);
    mdWatcher.onDidChange(refreshNotesViews);
  };

  refreshMarkdownWatcher();
  context.subscriptions.push({
    dispose: () => mdWatcher?.dispose(),
  });

  let taskWatcher: vscode.Disposable | undefined;
  const refreshTaskWatcher = () => {
    taskWatcher?.dispose();
    taskWatcher = undefined;
    const dir = getNotesDir();
    if (dir) taskWatcher = createTaskFileWatcher(dir, context);
  };
  refreshTaskWatcher();
  context.subscriptions.push({ dispose: () => taskWatcher?.dispose() });

  // AI status bar item (Task 8)
  const aiStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  aiStatusBar.text = "$(checklist) AI Tasks";
  aiStatusBar.tooltip = "Open AI Task Dashboard";
  aiStatusBar.command = "notes.openDashboard";
  aiStatusBar.show();
  context.subscriptions.push(aiStatusBar);

  DashboardPanel.setStatusListener((processing) => {
    aiStatusBar.text = processing ? "$(loading~spin) AI: 解析中…" : "$(checklist) AI Tasks";
  });

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("notes.notesDirectory") ||
      event.affectsConfiguration(`notes.${WORKSPACE_NOTES_DIRECTORY_KEY}`)
    ) {
      void migrateNotesDirectoryStorage().then(() => {
        refreshMarkdownWatcher();
        refreshTaskWatcher();
        refreshNotesViews();
      });
      return;
    }

    if (
      event.affectsConfiguration("notes.momentsSubfolder") ||
      event.affectsConfiguration("notes.sidebarRecentLimit") ||
      event.affectsConfiguration("notes.sidebarTagSort")
    ) {
      if (event.affectsConfiguration("notes.momentsSubfolder")) {
        refreshMarkdownWatcher();
        refreshTaskWatcher();
      }

      refreshNotesViews();
    }
  });

  // Run Setup command
  const runSetupDisposable = vscode.commands.registerCommand("notes.runSetup", async () => {
    const hasWorkspace =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
    let scope: "global" | "workspace" = "global";

    if (hasWorkspace) {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: "$(globe) Global (all workspaces)",
            description: "Stored in machine-local extension storage",
            value: "global" as const,
          },
          {
            label: "$(folder) This Workspace only",
            description: "Stored in workspace settings (.vscode/settings.json)",
            value: "workspace" as const,
          },
        ],
        { placeHolder: "Set notes directory for..." },
      );
      if (!choice) {
        return;
      }
      scope = choice.value;
    }

    const notesDir = await selectNotesDirectory(scope);
    if (notesDir) {
      refreshMarkdownWatcher();
      refreshNotesViews();
      const scopeLabel = scope === "workspace" ? "workspace" : "global";
      vscode.window.showInformationMessage(`Notes directory set (${scopeLabel}): ${notesDir}`);
    }
  });

  // Refresh sidebar command
  const refreshDisposable = vscode.commands.registerCommand("notes.refreshSidebar", () => {
    notesTreeProvider.refresh();
  });

  const toggleTagSortDisposable = vscode.commands.registerCommand(
    "notes.toggleTagSort",
    async () => {
      const nextMode: SidebarTagSortMode =
        getSidebarTagSort() === "frequency" ? "alphabetical" : "frequency";

      await vscode.workspace
        .getConfiguration("notes")
        .update("sidebarTagSort", nextMode, vscode.ConfigurationTarget.Global);

      notesTreeProvider.refresh();
      vscode.window.showInformationMessage(`Sidebar tag sort: ${nextMode}`);
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
    notesTreeProvider.refresh();
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
      if (!filePath || !fs.existsSync(filePath)) {
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
      notesTreeProvider.refresh();
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
      notesTreeProvider.refresh();
    },
  );

  const movePinnedNoteUpDisposable = vscode.commands.registerCommand(
    "notes.movePinnedNoteUp",
    async (item?: { relativePath?: string }) => {
      const relativePath = item?.relativePath ?? selectedSidebarItem?.relativePath;
      if (!relativePath) {
        return;
      }

      const current = getPinnedRelativePaths();
      const index = current.indexOf(relativePath);
      await setPinnedRelativePaths(movePinnedItem(current, index, "up"));
      notesTreeProvider.refresh();
    },
  );

  const movePinnedNoteDownDisposable = vscode.commands.registerCommand(
    "notes.movePinnedNoteDown",
    async (item?: { relativePath?: string }) => {
      const relativePath = item?.relativePath ?? selectedSidebarItem?.relativePath;
      if (!relativePath) {
        return;
      }

      const current = getPinnedRelativePaths();
      const index = current.indexOf(relativePath);
      await setPinnedRelativePaths(movePinnedItem(current, index, "down"));
      notesTreeProvider.refresh();
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

      const templatePath =
        vscode.workspace.getConfiguration("notes").get<string>("dailyNoteTemplate") || undefined;

      await openDailyNote(notesDir, templatePath);
      notesTreeProvider.refresh();
    },
  );

  const openDashboardDisposable = vscode.commands.registerCommand(
    "notes.openDashboard",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) return;
      DashboardPanel.createOrShow(getNotesDir, context.extensionUri);
    },
  );

  const aiPlanDayDisposable = vscode.commands.registerCommand(
    "notes.aiPlanDay",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) return;
      DashboardPanel.createOrShow(getNotesDir, context.extensionUri);
      // Give the panel a moment to initialize before triggering planDay
      setTimeout(() => DashboardPanel.runPlanDay(), 300);
    },
  );

  const aiExtractTasksDisposable = vscode.commands.registerCommand(
    "notes.aiExtractTasks",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) return;
      DashboardPanel.createOrShow(getNotesDir, context.extensionUri);
      setTimeout(() => DashboardPanel.runAiExtract(), 300);
    },
  );

  const archiveMomentsDisposable = vscode.commands.registerCommand(
    "notes.archiveMoments",
    async () => {
      const notesDir = await ensureNotesDirectory();
      if (!notesDir) {
        return;
      }

      const config = vscode.workspace.getConfiguration("notes");
      const afterDays = config.get<number>("momentsArchiveAfterDays") ?? 90;

      const confirm = await vscode.window.showWarningMessage(
        `Move Moments files older than ${afterDays} days to archive?`,
        "Archive",
        "Cancel",
      );
      if (confirm !== "Archive") {
        return;
      }

      const { archived, skipped } = await archiveMoments(notesDir);
      if (archived === 0) {
        vscode.window.showInformationMessage(
          `No Moments files to archive (${skipped} recent files kept).`,
        );
      } else {
        vscode.window.showInformationMessage(
          `Archived ${archived} Moments file${archived === 1 ? "" : "s"} (${skipped} recent files kept).`,
        );
        momentsProvider.refresh();
      }
    },
  );

  context.subscriptions.push(
    configChangeDisposable,
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
    archiveMomentsDisposable,
    openDashboardDisposable,
    aiPlanDayDisposable,
    aiExtractTasksDisposable,
  );
}

export function deactivate() {}
