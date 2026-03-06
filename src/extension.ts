import * as fs from "fs";
import * as vscode from "vscode";
import { MomentsViewProvider } from "./momentsPanel";
import { createNewNote, listNotes } from "./noteCommands";
import { NotesTreeProvider } from "./sidebarProvider";

const LEGACY_GLOBAL_STATE_KEY = "notesDirectory";

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

  // Register sidebar tree view
  const notesTreeProvider = new NotesTreeProvider(getNotesDir);
  vscode.window.registerTreeDataProvider("notesExplorer", notesTreeProvider);

  // Register Moments webview view
  const momentsProvider = new MomentsViewProvider(getNotesDir);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MomentsViewProvider.viewType, momentsProvider),
  );

  void migrateLegacyNotesDirectory().then(() => {
    notesTreeProvider.refresh();
    momentsProvider.refresh();
  });

  // Watch for new/deleted/changed .md files for sidebar refresh
  const mdWatcher = vscode.workspace.createFileSystemWatcher("**/*.md");
  mdWatcher.onDidCreate(() => notesTreeProvider.refresh());
  mdWatcher.onDidDelete(() => notesTreeProvider.refresh());
  mdWatcher.onDidChange(() => notesTreeProvider.refresh());
  context.subscriptions.push(mdWatcher);

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("notes.notesDirectory") ||
      event.affectsConfiguration("notes.momentsSubfolder")
    ) {
      notesTreeProvider.refresh();
      momentsProvider.refresh();
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

  context.subscriptions.push(
    configChangeDisposable,
    runSetupDisposable,
    refreshDisposable,
    newNoteDisposable,
    listNotesDisposable,
    focusMomentsDisposable,
    openNoteFileDisposable,
  );
}

export function deactivate() {}
