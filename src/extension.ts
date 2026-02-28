import * as vscode from "vscode";
import * as fs from "fs";
import { NotesTreeProvider } from "./sidebarProvider";
import { createNewNote, listNotes } from "./noteCommands";

function getNotesDir(): string | undefined {
  const config = vscode.workspace.getConfiguration("notes");
  return config.get<string>("notesDirectory") || undefined;
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
    const config = vscode.workspace.getConfiguration("notes");
    await config.update("notesDirectory", notesDir, vscode.ConfigurationTarget.Global);
    return notesDir;
  }
  return undefined;
}

async function ensureNotesDirectory(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("notes");
  let notesDir = config.get<string>("notesDirectory");

  if (!notesDir) {
    notesDir = await selectNotesDirectory();
    if (!notesDir) {
      vscode.window.showErrorMessage("Notes directory is not configured. Run 'Notes: Run Setup' first.");
      return undefined;
    }
  }
  return notesDir;
}

export function activate(context: vscode.ExtensionContext) {
  // Register sidebar tree view
  const notesTreeProvider = new NotesTreeProvider(getNotesDir);
  vscode.window.registerTreeDataProvider("notesExplorer", notesTreeProvider);

  // Watch for new/deleted/changed .md files for sidebar refresh
  const mdWatcher = vscode.workspace.createFileSystemWatcher("**/*.md");
  mdWatcher.onDidCreate(() => notesTreeProvider.refresh());
  mdWatcher.onDidDelete(() => notesTreeProvider.refresh());
  mdWatcher.onDidChange(() => notesTreeProvider.refresh());
  context.subscriptions.push(mdWatcher);

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

  // Open Note File command (used by sidebar)
  const openNoteFileDisposable = vscode.commands.registerCommand("notes.openNoteFile", async (filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
  });

  context.subscriptions.push(
    runSetupDisposable,
    refreshDisposable,
    newNoteDisposable,
    listNotesDisposable,
    openNoteFileDisposable
  );
}

export function deactivate() {}

