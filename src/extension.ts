// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
import * as path from "path";
import * as fs from "fs";

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

export function activate(context: vscode.ExtensionContext) {
  // Run Setup command - allows changing the notes directory at any time
  const runSetupDisposable = vscode.commands.registerCommand("notes.runSetup", async () => {
    const notesDir = await selectNotesDirectory();
    if (notesDir) {
      vscode.window.showInformationMessage(`Notes directory set to: ${notesDir}`);
    }
  });

  // Create Note command
  const createNoteDisposable = vscode.commands.registerCommand("notes.createNote", async () => {
    const config = vscode.workspace.getConfiguration("notes");
    let notesDir = config.get<string>("notesDirectory");

    if (!notesDir) {
      notesDir = await selectNotesDirectory();
      if (!notesDir) {
        vscode.window.showErrorMessage("Notes directory is not configured. Run 'Notes: Run Setup' first.");
        return;
      }
    }

    const title = await vscode.window.showInputBox({
      prompt: "Enter note title",
      placeHolder: "Test",
    });

    if (title === undefined) {
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const dateStr = `${year}_${month}_${day}`;
    const dateIso = `${year}-${month}-${day}`;

    const fileName = `${dateStr}_${title.replace(/\s+/g, "_")}.md`;
    const filePath = path.join(notesDir, fileName);

    if (fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`File already exists: ${fileName}`);
      return;
    }

    // Create empty file first
    try {
      fs.writeFileSync(filePath, "", "utf8");
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create note: ${err}`);
      return;
    }

    // Open the file and insert snippet with tab stops
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc);

    // SnippetString with tab stops for quick navigation:
    // $1 = tag, $2 = heading content, $0 = final cursor position (body)
    const snippet = new vscode.SnippetString(
      `---
tags:
    - \${1:tag}
title: ${title}
date: ${dateIso}
---

## \${2:heading}

\$0`
    );

    await editor.insertSnippet(snippet, new vscode.Position(0, 0));
  });

  context.subscriptions.push(runSetupDisposable, createNoteDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
