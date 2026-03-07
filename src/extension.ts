import * as fs from "fs";
import * as vscode from "vscode";
import { MomentsViewProvider, showOpenTasksOverview } from "./momentsPanel";
import { buildIndexedNotes, collectNoteFiles, createNewNote, listNotes } from "./noteCommands";
import {
  buildTagSummary,
  movePinnedItem,
  NotesTreeProvider,
  type SidebarTagSortMode,
} from "./sidebarProvider";

const LEGACY_GLOBAL_STATE_KEY = "notesDirectory";
const PINNED_NOTES_KEY = "pinnedNotes";

export function createNotesWatcherPattern(
  notesDir: string | undefined,
): vscode.GlobPattern | undefined {
  if (!notesDir) {
    return undefined;
  }

  return new vscode.RelativePattern(notesDir, "**/*.md");
}

export function activate(context: vscode.ExtensionContext) {
  function getNotesDir(): string | undefined {
    const configured = vscode.workspace.getConfiguration("notes").get<string>("notesDirectory");
    return configured || undefined;
  }

  async function setNotesDir(notesDir: string): Promise<void> {
    await vscode.workspace
      .getConfiguration("notes")
      .update("notesDirectory", notesDir, vscode.ConfigurationTarget.Global);
    await context.globalState.update(LEGACY_GLOBAL_STATE_KEY, undefined);
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

  async function migrateLegacyNotesDirectory(): Promise<void> {
    const configured = getNotesDir();
    const legacy = context.globalState.get<string>(LEGACY_GLOBAL_STATE_KEY);

    if (!configured && legacy) {
      await setNotesDir(legacy);
    }
  }

  async function selectNotesDirectory(): Promise<string | undefined> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select Notes Directory",
    });

    if (selected && selected[0]) {
      const notesDir = selected[0].fsPath;
      await setNotesDir(notesDir);
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
    const tags = buildTagSummary(
      indexedNotes.map((note) => ({ tags: note.metadata.tags })),
      getSidebarTagSort(),
    );

    if (tags.length === 0) {
      vscode.window.showInformationMessage("No tags found.");
      return;
    }

    const selectedTag = await vscode.window.showQuickPick(
      tags.map(({ tag, count }) => ({
        label: tag,
        description: `${count} note${count === 1 ? "" : "s"}`,
      })),
      {
        placeHolder: "Search tags",
        matchOnDescription: true,
      },
    );

    if (!selectedTag) {
      return;
    }

    const matchingNotes = indexedNotes.filter((note) =>
      note.metadata.tags.includes(selectedTag.label),
    );
    const selectedNote = await vscode.window.showQuickPick(
      matchingNotes.map((note) => ({
        label: `$(file) ${note.metadata.title}`,
        description: note.relativePath,
        detail: [
          note.metadata.tags.join(" "),
          `Updated ${new Date(note.mtime).toLocaleString()}`,
          note.preview,
        ]
          .filter(Boolean)
          .join("  •  "),
        filePath: note.absolutePath,
      })),
      {
        placeHolder: `Notes tagged ${selectedTag.label}`,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );

    if (!selectedNote) {
      return;
    }

    const doc = await vscode.workspace.openTextDocument(selectedNote.filePath);
    await vscode.window.showTextDocument(doc);
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
  const momentsProvider = new MomentsViewProvider(getNotesDir);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MomentsViewProvider.viewType, momentsProvider),
  );

  void migrateLegacyNotesDirectory().then(() => {
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

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("notes.notesDirectory") ||
      event.affectsConfiguration("notes.momentsSubfolder") ||
      event.affectsConfiguration("notes.sidebarRecentLimit") ||
      event.affectsConfiguration("notes.sidebarTagSort")
    ) {
      if (
        event.affectsConfiguration("notes.notesDirectory") ||
        event.affectsConfiguration("notes.momentsSubfolder")
      ) {
        refreshMarkdownWatcher();
      }

      refreshNotesViews();
    }
  });

  // Run Setup command
  const runSetupDisposable = vscode.commands.registerCommand("notes.runSetup", async () => {
    const notesDir = await selectNotesDirectory();
    if (notesDir) {
      notesTreeProvider.refresh();
      vscode.window.showInformationMessage(`Notes directory set to: ${notesDir}`);
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
  );
}

export function deactivate() {}
