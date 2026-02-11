import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

const TEMPLATES_DIR = ".noteeees/templates";
const MEMORY_FILE_NAME = "memory.md";

const DEFAULT_TEMPLATE_CONTENT = `---
tags:
  - 
title: "{{title}}"
date: "{{date}}"
---

# {{title}}

`;

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

function getTemplatesDir(notesDir: string): string {
  return path.join(notesDir, TEMPLATES_DIR);
}

function ensureTemplatesDir(notesDir: string): string {
  const templatesDir = getTemplatesDir(notesDir);
  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
  }
  return templatesDir;
}

function getTemplateFiles(notesDir: string): string[] {
  const templatesDir = getTemplatesDir(notesDir);
  if (!fs.existsSync(templatesDir)) {
    return [];
  }

  return fs
    .readdirSync(templatesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

function applyTemplateVariables(content: string, title: string, now: Date): string {
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const datetimeStr = `${dateStr} ${timeStr}`;

  return content
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{datetime\}\}/g, datetimeStr);
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

  // Step 3: Select template
  const templates = getTemplateFiles(notesDir);
  let templateContent = "";
  const config = vscode.workspace.getConfiguration("notes");
  const defaultTemplate = config.get<string>("defaultTemplate") || "";

  if (defaultTemplate) {
    // Use configured default template
    const templatePath = path.join(getTemplatesDir(notesDir), `${defaultTemplate}.md`);
    if (fs.existsSync(templatePath)) {
      templateContent = fs.readFileSync(templatePath, "utf8");
    }
  } else if (templates.length > 0) {
    // Show template picker
    const templateItems: vscode.QuickPickItem[] = [
      { label: "$(file) Empty", description: "Create without template" },
      ...templates.map((t) => ({
        label: `$(file-code) ${path.basename(t, ".md")}`,
        description: t,
      })),
    ];

    const selected = await vscode.window.showQuickPick(templateItems, {
      placeHolder: "Select a template (Esc for empty)",
    });

    if (selected && !selected.label.includes("Empty")) {
      const templateName = selected.label.replace("$(file-code) ", "");
      const templatePath = path.join(getTemplatesDir(notesDir), `${templateName}.md`);
      if (fs.existsSync(templatePath)) {
        templateContent = fs.readFileSync(templatePath, "utf8");
      }
    }
  }

  // Step 4: Generate filename
  const now = new Date();
  const filename = resolveFilename(title, now);

  // Step 5: Create directories as needed
  const targetDir = subDir ? path.join(notesDir, subDir) : notesDir;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Step 6: Create file
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

  const finalContent = templateContent ? applyTemplateVariables(templateContent, title, now) : "";

  fs.writeFileSync(filePath, finalContent, "utf8");

  // Step 7: Open the file
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(`Note created: ${filename}`);
}

export async function createTemplate(notesDir: string): Promise<void> {
  const templateName = await vscode.window.showInputBox({
    prompt: "Enter template name",
    placeHolder: "meeting",
  });

  if (!templateName) {
    return;
  }

  const templatesDir = ensureTemplatesDir(notesDir);
  const templatePath = path.join(templatesDir, `${templateName}.md`);

  if (fs.existsSync(templatePath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Template "${templateName}" already exists. Overwrite?`,
      "Yes",
      "No",
    );
    if (overwrite !== "Yes") {
      return;
    }
  }

  fs.writeFileSync(templatePath, DEFAULT_TEMPLATE_CONTENT, "utf8");

  const doc = await vscode.workspace.openTextDocument(templatePath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(`Template created: ${templateName}.md`);
}

export async function listTemplates(notesDir: string): Promise<void> {
  const templates = getTemplateFiles(notesDir);

  if (templates.length === 0) {
    const create = await vscode.window.showInformationMessage(
      "No templates found. Create one?",
      "Create Template",
      "Cancel",
    );
    if (create === "Create Template") {
      await createTemplate(notesDir);
    }
    return;
  }

  const items: vscode.QuickPickItem[] = templates.map((t) => ({
    label: `$(file-code) ${path.basename(t, ".md")}`,
    description: t,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a template to edit",
  });

  if (selected) {
    const templateName = selected.label.replace("$(file-code) ", "");
    const templatePath = path.join(getTemplatesDir(notesDir), `${templateName}.md`);
    const doc = await vscode.workspace.openTextDocument(templatePath);
    await vscode.window.showTextDocument(doc);
  }
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

    // Skip hidden directories and .noteeees
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
