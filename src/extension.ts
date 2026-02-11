import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { TagCompletionProvider } from "./tagCompletion";
import { showSearchQuickPick } from "./searchCommand";
import { NotesTreeProvider, registerGoToLineCommand } from "./sidebarProvider";
import { showReminders } from "./reminderCommand";
import { showStructureSearch } from "./structureSearchCommand";
import { createNewNote, listNotes } from "./noteCommands";

const MEMORY_FILE_NAME = "memory.md";
const MEMORY_HEADER = "# Memory Log\n\n";

function getMemoryFilePath(): string | undefined {
  const config = vscode.workspace.getConfiguration("notes");
  const notesDir = config.get<string>("notesDirectory");
  if (!notesDir) {
    return undefined;
  }
  return path.join(notesDir, MEMORY_FILE_NAME);
}

function getNotesDir(): string | undefined {
  const config = vscode.workspace.getConfiguration("notes");
  return config.get<string>("notesDirectory") || undefined;
}

function ensureMemoryFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, MEMORY_HEADER, "utf8");
  }
}

function formatDateTime(date: Date): string {
  const config = vscode.workspace.getConfiguration("notes");
  const format = config.get<string>("dateFormat") || "YYYY-MM-DD HH:mm";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return format
    .replace("YYYY", String(year))
    .replace("MM", month)
    .replace("DD", day)
    .replace("HH", hours)
    .replace("mm", minutes);
}

function getEntryPosition(): "top" | "bottom" {
  const config = vscode.workspace.getConfiguration("notes");
  return config.get<"top" | "bottom">("entryPosition") || "top";
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
  // Register tag completion provider
  const tagCompletionProvider = new TagCompletionProvider(getMemoryFilePath);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "markdown" },
      tagCompletionProvider,
      "#"
    )
  );

  // Register sidebar tree view
  const notesTreeProvider = new NotesTreeProvider(getMemoryFilePath, getNotesDir);
  vscode.window.registerTreeDataProvider("notesExplorer", notesTreeProvider);
  registerGoToLineCommand(context, getMemoryFilePath);

  // Refresh tree when files change
  const memoryWatcher = vscode.workspace.createFileSystemWatcher("**/memory.md");
  memoryWatcher.onDidChange(() => notesTreeProvider.refresh());
  memoryWatcher.onDidCreate(() => notesTreeProvider.refresh());
  memoryWatcher.onDidDelete(() => notesTreeProvider.refresh());
  context.subscriptions.push(memoryWatcher);

  // Watch for new/deleted .md files for sidebar refresh
  const mdWatcher = vscode.workspace.createFileSystemWatcher("**/*.md");
  mdWatcher.onDidCreate(() => notesTreeProvider.refresh());
  mdWatcher.onDidDelete(() => notesTreeProvider.refresh());
  context.subscriptions.push(mdWatcher);

  // Run Setup command
  const runSetupDisposable = vscode.commands.registerCommand("notes.runSetup", async () => {
    const notesDir = await selectNotesDirectory();
    if (notesDir) {
      const memoryPath = path.join(notesDir, MEMORY_FILE_NAME);
      ensureMemoryFile(memoryPath);
      notesTreeProvider.refresh();
      vscode.window.showInformationMessage(`Notes directory set to: ${notesDir}`);
    }
  });

  // Open Memory command
  const openMemoryDisposable = vscode.commands.registerCommand("notes.openMemory", async () => {
    const memoryPath = getMemoryFilePath();
    if (!memoryPath) {
      vscode.window.showErrorMessage("Notes directory is not configured. Run 'Notes: Run Setup' first.");
      return;
    }

    ensureMemoryFile(memoryPath);
    const doc = await vscode.workspace.openTextDocument(memoryPath);
    await vscode.window.showTextDocument(doc);
  });

  // Add Entry command
  const addEntryDisposable = vscode.commands.registerCommand("notes.addEntry", async () => {
    const notesDir = await ensureNotesDirectory();
    if (!notesDir) {
      return;
    }

    const memoryPath = path.join(notesDir, MEMORY_FILE_NAME);
    ensureMemoryFile(memoryPath);

    const doc = await vscode.workspace.openTextDocument(memoryPath);
    const editor = await vscode.window.showTextDocument(doc);

    const now = new Date();
    const dateTime = formatDateTime(now);
    const position = getEntryPosition();

    let insertPosition: vscode.Position;
    if (position === "top") {
      const text = doc.getText();
      const headerMatch = text.match(/^# Memory Log\n\n/);
      insertPosition = new vscode.Position(headerMatch ? 2 : 0, 0);
    } else {
      insertPosition = new vscode.Position(doc.lineCount, 0);
    }

    const snippet = new vscode.SnippetString(
      `\n## ${dateTime} #\${1:tag}\n\${2:content}\n\n\$0`
    );

    await editor.insertSnippet(snippet, insertPosition);
  });

  // Quick Add command
  const quickAddDisposable = vscode.commands.registerCommand("notes.quickAdd", async () => {
    const notesDir = await ensureNotesDirectory();
    if (!notesDir) {
      return;
    }

    const input = await vscode.window.showInputBox({
      prompt: "Quick note (use #tag for tags)",
      placeHolder: "#todo 経費精算の期限は2/5まで",
    });

    if (!input) {
      return;
    }

    const tagMatches = input.match(/#\w+/g) || [];
    const tags = tagMatches.join(" ");
    const content = input.replace(/#\w+\s*/g, "").trim();

    const memoryPath = path.join(notesDir, MEMORY_FILE_NAME);
    ensureMemoryFile(memoryPath);

    const now = new Date();
    const dateTime = formatDateTime(now);
    const position = getEntryPosition();

    let existingContent = fs.readFileSync(memoryPath, "utf8");

    const tagSection = tags ? ` ${tags}` : "";
    const newEntry = `\n## ${dateTime}${tagSection}\n${content}\n\n`;

    if (position === "top") {
      if (existingContent.startsWith(MEMORY_HEADER)) {
        existingContent = MEMORY_HEADER + newEntry + existingContent.slice(MEMORY_HEADER.length);
      } else {
        existingContent = MEMORY_HEADER + newEntry + existingContent;
      }
    } else {
      existingContent = existingContent + newEntry;
    }

    fs.writeFileSync(memoryPath, existingContent, "utf8");
    notesTreeProvider.refresh();
    vscode.window.showInformationMessage("Entry added to memory.");
  });

  // Search command
  const searchDisposable = vscode.commands.registerCommand("notes.search", async () => {
    const memoryPath = getMemoryFilePath();
    if (!memoryPath) {
      vscode.window.showErrorMessage("Notes directory is not configured. Run 'Notes: Run Setup' first.");
      return;
    }

    await showSearchQuickPick(memoryPath);
  });

  // Structure Search command
  const structureSearchDisposable = vscode.commands.registerCommand("notes.structureSearch", async () => {
    const memoryPath = getMemoryFilePath();
    if (!memoryPath) {
      vscode.window.showErrorMessage("Notes directory is not configured. Run 'Notes: Run Setup' first.");
      return;
    }

    await showStructureSearch(memoryPath);
  });

  // Reminders command
  const remindersDisposable = vscode.commands.registerCommand("notes.showReminders", async () => {
    const memoryPath = getMemoryFilePath();
    if (!memoryPath) {
      vscode.window.showErrorMessage("Notes directory is not configured. Run 'Notes: Run Setup' first.");
      return;
    }

    await showReminders(memoryPath);
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
    openMemoryDisposable,
    addEntryDisposable,
    quickAddDisposable,
    searchDisposable,
    structureSearchDisposable,
    remindersDisposable,
    refreshDisposable,
    newNoteDisposable,
    listNotesDisposable,
    openNoteFileDisposable
  );
}

export function deactivate() {}
