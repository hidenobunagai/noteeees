import * as vscode from "vscode";
import { registerNotesCommands } from "./commands.js";
import { enrichTasksInFile } from "./dashboardAiEnrichment.js";
import { DashboardPanel } from "./dashboardPanel";
import { isPathInside } from "./dashboardTaskUtils.js";
import { MomentsViewProvider } from "./moments/panel.js";
import {
  createNewNote,
  type IndexedNote,
  pickIndexedNote,
} from "./noteCommands";
import { getIndexedNotesCached } from "./notesIndexCache.js";
import { t } from "./i18n.js";
import {
  affectsNotesConfiguration,
  getAiAutoEnrichSetting,
  getLegacyNotesDirectorySetting,
  getMomentsSubfolderSetting,
  getSidebarTagSortSetting,
  getStatusBarTasksSetting,
  getWorkspaceNotesDirectorySetting,
  updateLegacyNotesDirectorySetting,
  updateWorkspaceNotesDirectorySetting,
} from "./notesConfig.js";
import {
  buildSidebarTagGroups,
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
    return getLegacyNotesDirectorySetting();
  }

  function getWorkspaceNotesDir(): string | undefined {
    return getWorkspaceNotesDirectorySetting();
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
      await updateWorkspaceNotesDirectorySetting(notesDir, vscode.ConfigurationTarget.Workspace);
      return;
    }

    await context.globalState.update(NOTES_DIRECTORY_STORAGE_KEY, notesDir);

    if (getConfiguredNotesDir()) {
      await updateLegacyNotesDirectorySetting(undefined, vscode.ConfigurationTarget.Global);
    }
  }

  function getPinnedRelativePaths(): string[] {
    return context.globalState.get<string[]>(PINNED_NOTES_KEY) ?? [];
  }

  async function setPinnedRelativePaths(paths: string[]): Promise<void> {
    await context.globalState.update(PINNED_NOTES_KEY, [...new Set(paths)]);
  }

  async function migrateNotesDirectoryStorage(): Promise<void> {
    const stored = context.globalState.get<string>(NOTES_DIRECTORY_STORAGE_KEY);
    const configured = getConfiguredNotesDir();

    if (!stored && configured) {
      await setNotesDir(configured);
      return;
    }

    if (stored && configured) {
      await updateLegacyNotesDirectorySetting(undefined, vscode.ConfigurationTarget.Global);
    }
  }

  async function selectNotesDirectory(
    scope: "global" | "workspace" = "global",
  ): Promise<string | undefined> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: t("selectNotesDirectory"),
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
        vscode.window.showErrorMessage(t("notesDirNotConfigured"));
        return undefined;
      }
    }
    return notesDir;
  }

  async function getIndexedNotes(notesDir: string) {
    const momentsSubfolder = getMomentsSubfolderSetting();
    return (await getIndexedNotesCached(notesDir, [momentsSubfolder])).sort(
      (a, b) => b.mtime - a.mtime,
    );
  }

  async function searchTags(notesDir: string): Promise<void> {
    const indexedNotes = await getIndexedNotes(notesDir);
    const tagItems = buildTagSearchItems(indexedNotes, getSidebarTagSortSetting());

    if (tagItems.length === 0) {
      vscode.window.showInformationMessage(t("noTagsFound"));
      return;
    }

    const selectedTag = await vscode.window.showQuickPick(tagItems, {
      placeHolder: t("searchTagsPlaceholder"),
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selectedTag) {
      return;
    }

    const matchingNotes = indexedNotes.filter((note) =>
      note.metadata.tags.includes(selectedTag.label),
    );
    const selectedNote = await pickIndexedNote(
      matchingNotes,
      t("notesTagged", { tag: selectedTag.label }),
    );

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
    getSidebarTagSortSetting,
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
  const momentsProvider = new MomentsViewProvider(getNotesDir, context);
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
  });

  let mdWatcher: vscode.FileSystemWatcher | undefined;
  let dashboardRefreshTimer: NodeJS.Timeout | undefined;
  const refreshNotesViews = () => {
    notesTreeProvider.refresh();
    momentsProvider.refresh();
  };

  const scheduleDashboardRefresh = (uri: vscode.Uri) => {
    const momentsSubfolder = getMomentsSubfolderSetting();
    if (
      uri.fsPath.includes(`/${momentsSubfolder}/`) ||
      uri.fsPath.includes(`\\${momentsSubfolder}\\`)
    ) {
      return;
    }
    if (dashboardRefreshTimer) {
      clearTimeout(dashboardRefreshTimer);
    }
    dashboardRefreshTimer = setTimeout(() => {
      dashboardRefreshTimer = undefined;
      DashboardPanel.refresh();
    }, 500);
  };

  const refreshMarkdownWatcher = () => {
    mdWatcher?.dispose();
    mdWatcher = undefined;

    const pattern = createNotesWatcherPattern(getNotesDir());
    if (!pattern) {
      return;
    }

    mdWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    mdWatcher.onDidCreate((uri) => {
      refreshNotesViews();
      scheduleDashboardRefresh(uri);
    });
    mdWatcher.onDidDelete((uri) => {
      refreshNotesViews();
      scheduleDashboardRefresh(uri);
    });
    mdWatcher.onDidChange((uri) => {
      refreshNotesViews();
      scheduleDashboardRefresh(uri);
    });
  };

  refreshMarkdownWatcher();
  context.subscriptions.push({
    dispose: () => {
      mdWatcher?.dispose();
      if (dashboardRefreshTimer) {
        clearTimeout(dashboardRefreshTimer);
      }
    },
  });

  // Task dashboard status bar item
  const aiStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  aiStatusBar.text = `$(checklist) ${t("tasksStatusBar")}`;
  aiStatusBar.tooltip = t("dashboardTitle");
  aiStatusBar.command = "notes.openDashboard";
  const syncStatusBarVisibility = () => {
    if (getStatusBarTasksSetting()) {
      aiStatusBar.show();
    } else {
      aiStatusBar.hide();
    }
  };
  syncStatusBarVisibility();
  context.subscriptions.push(aiStatusBar);

  const analyzingText = `$(loading~spin) ${t("tasksAnalyzing")}`;
  const idleText = `$(checklist) ${t("tasksStatusBar")}`;
  DashboardPanel.setStatusListener((processing) => {
    aiStatusBar.text = processing ? analyzingText : idleText;
  });

  // Hook file save events for AI task auto-enrichment
  const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!getAiAutoEnrichSetting()) {
      return;
    }

    const notesDir = getNotesDir();
    if (!notesDir) {
      return;
    }

    const filePath = document.uri.fsPath;
    if (!filePath.endsWith(".md")) {
      return;
    }

    if (!isPathInside(notesDir, filePath)) {
      return;
    }

    aiStatusBar.text = analyzingText;
    const cts = new vscode.CancellationTokenSource();

    try {
      await enrichTasksInFile(filePath, notesDir, context.globalState, cts.token);
    } catch (e) {
      console.error("Error during auto-enrichment on save:", e);
    } finally {
      aiStatusBar.text = idleText;
      DashboardPanel.refresh();
    }
  });

  context.subscriptions.push(onSaveDisposable);

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (affectsNotesConfiguration(event, "statusBarTasks")) {
      syncStatusBarVisibility();
    }

    if (affectsNotesConfiguration(event, "locale")) {
      refreshNotesViews();
      DashboardPanel.refresh();
    }

    if (
      affectsNotesConfiguration(event, "notesDirectory") ||
      affectsNotesConfiguration(event, WORKSPACE_NOTES_DIRECTORY_KEY)
    ) {
      void migrateNotesDirectoryStorage().then(() => {
        refreshMarkdownWatcher();
        refreshNotesViews();
      });
      return;
    }

    if (
      affectsNotesConfiguration(event, "momentsSubfolder") ||
      affectsNotesConfiguration(event, "sidebarRecentLimit") ||
      affectsNotesConfiguration(event, "sidebarTagSort")
    ) {
      if (affectsNotesConfiguration(event, "momentsSubfolder")) {
        refreshMarkdownWatcher();
      }

      refreshNotesViews();
    }
  });

  context.subscriptions.push(
    configChangeDisposable,
    ...registerNotesCommands(context, {
      getNotesDir,
      ensureNotesDirectory,
      selectNotesDirectory,
      getPinnedRelativePaths,
      setPinnedRelativePaths,
      getSelectedSidebarItem: () => selectedSidebarItem,
      refreshNotesTree: () => notesTreeProvider.refresh(),
      refreshMoments: () => momentsProvider.refresh(),
      refreshMarkdownWatcher,
      searchTags,
    }),
  );
}

export function deactivate() {}
