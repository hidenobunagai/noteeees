import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

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

function ensureMemoryFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, MEMORY_HEADER, "utf8");
  }
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
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
  // Run Setup command
  const runSetupDisposable = vscode.commands.registerCommand("notes.runSetup", async () => {
    const notesDir = await selectNotesDirectory();
    if (notesDir) {
      const memoryPath = path.join(notesDir, MEMORY_FILE_NAME);
      ensureMemoryFile(memoryPath);
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

  // Add Entry command - full entry with snippet navigation
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

    // Find insertion point (after header)
    let insertLine = 0;
    const text = doc.getText();
    const headerMatch = text.match(/^# Memory Log\n\n/);
    if (headerMatch) {
      insertLine = 2; // After "# Memory Log\n\n"
    }

    // Insert snippet with tab stops: $1 = tags, $2 = content, $0 = final position
    const snippet = new vscode.SnippetString(
      `## ${dateTime} \${1:#tag}\n\${2:content}\n\n\$0`
    );

    await editor.insertSnippet(snippet, new vscode.Position(insertLine, 0));
  });

  // Quick Add command - one-liner from input box
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

    // Extract tags from input
    const tagMatches = input.match(/#\w+/g) || [];
    const tags = tagMatches.join(" ");
    const content = input.replace(/#\w+\s*/g, "").trim();

    const memoryPath = path.join(notesDir, MEMORY_FILE_NAME);
    ensureMemoryFile(memoryPath);

    const now = new Date();
    const dateTime = formatDateTime(now);

    // Read existing content
    let existingContent = fs.readFileSync(memoryPath, "utf8");

    // Prepare new entry
    const tagSection = tags ? ` ${tags}` : "";
    const newEntry = `## ${dateTime}${tagSection}\n${content}\n\n`;

    // Insert after header
    if (existingContent.startsWith(MEMORY_HEADER)) {
      existingContent = MEMORY_HEADER + newEntry + existingContent.slice(MEMORY_HEADER.length);
    } else {
      existingContent = MEMORY_HEADER + newEntry + existingContent;
    }

    fs.writeFileSync(memoryPath, existingContent, "utf8");
    vscode.window.showInformationMessage("Entry added to memory.");
  });

  context.subscriptions.push(
    runSetupDisposable,
    openMemoryDisposable,
    addEntryDisposable,
    quickAddDisposable
  );
}

export function deactivate() {}
