import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

const MEMORY_FILE_NAME = "memory.md";
const SNIPPET_PREFIX = "noteeees_template_";

/** Built-in fallback snippet body used when the named snippet is not found. */
const FALLBACK_SNIPPET_BODY = "# ${1:${TM_FILENAME_BASE}}\n\n${0}";

interface FilenameToken {
  type: "datetime" | "title" | "extension";
  token: string;
  format: string;
}

const DEFAULT_TOKENS: FilenameToken[] = [
  { type: "datetime", token: "{dt}", format: "YYYY-MM-DD_HH-mm" },
  { type: "title", token: "{title}", format: "Untitled" },
  { type: "extension", token: "{ext}", format: "md" },
];

function formatDateTimeToken(format: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return format
    .replace("YYYY", String(year))
    .replace("MM", month)
    .replace("DD", day)
    .replace("HH", hours)
    .replace("mm", minutes)
    .replace("ss", seconds);
}

function resolveFilename(titleInput: string, now: Date): string {
  const config = vscode.workspace.getConfiguration("notes");
  const titleFormat = config.get<string>("defaultNoteTitle") || "{dt}_{title}.{ext}";
  const convertSpaces = config.get<string>("noteTitleConvertSpaces") ?? "_";

  let filename = titleFormat;

  for (const token of DEFAULT_TOKENS) {
    if (!filename.includes(token.token)) {
      continue;
    }

    let replacement: string;
    switch (token.type) {
      case "datetime":
        replacement = formatDateTimeToken(token.format, now);
        break;
      case "title":
        replacement = titleInput || token.format;
        break;
      case "extension":
        replacement = token.format;
        break;
    }

    filename = filename.replace(token.token, replacement);
  }

  if (convertSpaces) {
    // Only convert spaces in the filename part, not the extension
    const extIndex = filename.lastIndexOf(".");
    if (extIndex > 0) {
      const name = filename.substring(0, extIndex).replace(/ /g, convertSpaces);
      const ext = filename.substring(extIndex);
      filename = name + ext;
    } else {
      filename = filename.replace(/ /g, convertSpaces);
    }
  }

  return filename;
}

async function insertSnippetByName(editor: vscode.TextEditor, langId: string, snippetName: string): Promise<boolean> {
  // Try named snippet lookup first (extension-contributed or user-defined)
  try {
    const docBefore = editor.document.getText();
    await vscode.commands.executeCommand("editor.action.insertSnippet", {
      langId,
      name: snippetName,
    });
    // Check if the document actually changed — the command may resolve
    // without throwing even when the named snippet is not found.
    if (editor.document.getText() !== docBefore) {
      return true;
    }
  } catch {
    // Named snippet not found — fall through to fallback.
  }

  // Fallback: insert the built-in default snippet directly.
  try {
    await editor.insertSnippet(new vscode.SnippetString(FALLBACK_SNIPPET_BODY));
    return true;
  } catch {
    return false;
  }
}

export async function createNewNote(notesDir: string): Promise<void> {
  // Step 1: Ask for note title
  const titleInput = await vscode.window.showInputBox({
    prompt: "Enter note title (use / for subfolders)",
    placeHolder: "Meeting Notes  or  projects/ProjectX",
  });

  if (!titleInput) {
    return;
  }

  // Step 2: Detect file path
  let subDir = "";
  let title = titleInput;
  const lastSep = titleInput.lastIndexOf("/");
  if (lastSep >= 0) {
    subDir = titleInput.substring(0, lastSep);
    title = titleInput.substring(lastSep + 1);
  }

  // Step 3: Generate filename
  const now = new Date();
  const filename = resolveFilename(title, now);

  // Step 4: Create directories as needed
  const targetDir = subDir ? path.join(notesDir, subDir) : notesDir;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Step 5: Create file
  const filePath = path.join(targetDir, filename);
  if (fs.existsSync(filePath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `File "${filename}" already exists. Overwrite?`,
      "Yes",
      "No",
    );
    if (overwrite !== "Yes") {
      return;
    }
  }

  fs.writeFileSync(filePath, "", "utf8");

  // Step 6: Open the file
  const doc = await vscode.workspace.openTextDocument(filePath);
  const editor = await vscode.window.showTextDocument(doc);

  // Step 7: Insert snippet template
  const config = vscode.workspace.getConfiguration("notes");
  const defaultSnippet = config.get<{ langId: string; name: string }>("defaultSnippet");
  const templates = config.get<string[]>("templates") || [];

  if (templates.length > 0) {
    // Show template picker
    const templateItems: vscode.QuickPickItem[] = [
      { label: "$(file) Default", description: "Use default template" },
      ...templates.map((t) => ({
        label: `$(file-code) ${t}`,
        description: `${SNIPPET_PREFIX}${t}`,
      })),
    ];

    const selected = await vscode.window.showQuickPick(templateItems, {
      placeHolder: "Select a template (Esc for default)",
    });

    if (selected && !selected.label.includes("Default")) {
      const templateName = selected.label.replace("$(file-code) ", "");
      const snippetName = `${SNIPPET_PREFIX}${templateName}`;
      const langId = defaultSnippet?.langId || "markdown";
      await insertSnippetByName(editor, langId, snippetName);
    } else if (defaultSnippet?.name) {
      await insertSnippetByName(editor, defaultSnippet.langId, defaultSnippet.name);
    }
  } else if (defaultSnippet?.name) {
    // No custom templates, just use default snippet
    await insertSnippetByName(editor, defaultSnippet.langId, defaultSnippet.name);
  }

  vscode.window.showInformationMessage(`Note created: ${filename}`);
}

export async function listNotes(notesDir: string): Promise<void> {
  const noteFiles = collectNoteFiles(notesDir, notesDir);

  if (noteFiles.length === 0) {
    vscode.window.showInformationMessage("No notes found.");
    return;
  }

  // Sort by modification time, newest first
  noteFiles.sort((a, b) => b.mtime - a.mtime);

  const items: vscode.QuickPickItem[] = noteFiles.map((f) => ({
    label: `$(file) ${f.relativePath}`,
    description: new Date(f.mtime).toLocaleDateString(),
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `${noteFiles.length} notes found`,
  });

  if (selected) {
    const relativePath = selected.label.replace("$(file) ", "");
    const filePath = path.join(notesDir, relativePath);
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
  }
}

interface NoteFile {
  relativePath: string;
  absolutePath: string;
  mtime: number;
}

export function collectNoteFiles(baseDir: string, currentDir: string): NoteFile[] {
  const results: NoteFile[] = [];

  if (!fs.existsSync(currentDir)) {
    return results;
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    // Skip hidden directories
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...collectNoteFiles(baseDir, fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== MEMORY_FILE_NAME) {
      const stat = fs.statSync(fullPath);
      results.push({
        relativePath: path.relative(baseDir, fullPath),
        absolutePath: fullPath,
        mtime: stat.mtimeMs,
      });
    }
  }

  return results;
}
