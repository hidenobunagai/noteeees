import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

const SNIPPET_PREFIX = "noteeees_template_";

/** Built-in fallback snippet body used when the named snippet is not found. */
const FALLBACK_SNIPPET_BODY = "# ${1:${TM_FILENAME_BASE}}\n\n${0}";

interface FilenameToken {
  type: "datetime" | "title" | "extension";
  token: string;
  format: string;
}

export interface NoteMetadata {
  title: string;
  tags: string[];
}

function stripFrontMatter(rawContent: string): string {
  return rawContent.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

export function extractPreviewText(rawContent: string, maxLength: number = 140): string {
  const preview = stripFrontMatter(rawContent).replace(/\n+/g, " ").trim();
  if (preview.length <= maxLength) {
    return preview;
  }

  return `${preview.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeSearchText(text: string): string {
  return text.replace(/\n+/g, " ").trim();
}

function getSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function buildQueryExcerpt(text: string, query: string, maxLength: number = 100): string {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return "";
  }

  const terms = getSearchTerms(query);
  if (terms.length === 0) {
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
  }

  const lowered = normalized.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;

  for (const term of terms) {
    const index = lowered.indexOf(term);
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchLength = term.length;
    }
  }

  if (matchIndex === -1) {
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
  }

  const contextPadding = Math.max(0, Math.floor((maxLength - matchLength) / 2));
  const start = Math.max(0, matchIndex - contextPadding);
  const end = Math.min(normalized.length, start + maxLength);
  let adjustedStart = Math.max(0, end - maxLength);
  let adjustedEnd = end;

  if (adjustedStart > 0) {
    const nextWordBoundary = normalized.indexOf(" ", adjustedStart);
    if (nextWordBoundary !== -1 && nextWordBoundary < matchIndex) {
      adjustedStart = nextWordBoundary + 1;
    }
  }

  if (adjustedEnd < normalized.length) {
    const previousWordBoundary = normalized.lastIndexOf(" ", adjustedEnd);
    if (previousWordBoundary !== -1 && previousWordBoundary > matchIndex + matchLength) {
      adjustedEnd = previousWordBoundary;
    }
  }

  let excerpt = normalized.slice(adjustedStart, adjustedEnd).trim();

  if (adjustedStart > 0) {
    excerpt = `…${excerpt}`;
  }

  if (adjustedEnd < normalized.length) {
    excerpt = `${excerpt}…`;
  }

  return excerpt;
}

const DEFAULT_TOKENS: FilenameToken[] = [
  { type: "datetime", token: "{dt}", format: "YYYY-MM-DD_HH-mm-ss" },
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

export async function resolveUniqueFilePath(targetDir: string, filename: string): Promise<string> {
  const candidate = path.join(targetDir, filename);
  try {
    await fs.access(candidate);
  } catch {
    return candidate;
  }

  const extIndex = filename.lastIndexOf(".");
  const stem = extIndex > 0 ? filename.slice(0, extIndex) : filename;
  const ext = extIndex > 0 ? filename.slice(extIndex) : "";

  for (let i = 2; i <= 99; i++) {
    const uniquePath = path.join(targetDir, `${stem}-${i}${ext}`);
    try {
      await fs.access(uniquePath);
    } catch {
      return uniquePath;
    }
  }

  return candidate;
}

async function insertSnippetByName(
  editor: vscode.TextEditor,
  langId: string,
  snippetName: string,
): Promise<boolean> {
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

export function shouldPromptForTemplateSelection(templates: string[]): boolean {
  return templates.length > 0;
}

function extractFrontMatterTags(rawContent: string): string[] {
  const fmMatch = rawContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return [];
  }

  const tagsLine = fmMatch[1].match(/^tags\s*:\s*(.+)$/m);
  if (!tagsLine) {
    return [];
  }

  const raw = tagsLine[1].replace(/[\[\]]/g, "");
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
}

const INLINE_TAG_PATTERN = /#[\p{L}\p{M}\p{N}_\p{Pd}]+/gu;

function normalizeInlineTag(tag: string): string {
  return tag.normalize("NFKC");
}

function extractInlineTags(rawContent: string): string[] {
  return [
    ...new Set((rawContent.match(INLINE_TAG_PATTERN) || []).map((tag) => normalizeInlineTag(tag))),
  ];
}

export function extractNoteMetadata(rawContent: string, fallbackTitle: string): NoteMetadata {
  const headingMatch = rawContent.match(/^#\s+(.+)$/m);
  const title = headingMatch?.[1]?.trim() || fallbackTitle;
  const tags = [
    ...new Set([...extractFrontMatterTags(rawContent), ...extractInlineTags(rawContent)]),
  ];
  return { title, tags };
}

function formatModifiedAt(mtime: number): string {
  return new Date(mtime).toLocaleString();
}

export interface IndexedNote {
  relativePath: string;
  absolutePath: string;
  mtime: number;
  metadata: NoteMetadata;
  preview: string;
  searchText: string;
}

interface NoteQuickPickItem extends vscode.QuickPickItem {
  note?: IndexedNote;
  isCreateNew?: boolean;
  createTitle?: string;
}

export function buildNoteSearchDetail(note: IndexedNote, query: string = ""): string {
  const details = [`Updated ${formatModifiedAt(note.mtime)}`];

  if (note.metadata.tags.length > 0) {
    details.unshift(note.metadata.tags.join(" "));
  }

  const excerpt = buildQueryExcerpt(note.searchText || note.preview, query);
  if (excerpt) {
    details.push(excerpt);
  }

  return details.join("  •  ");
}

function toNoteQuickPickItem(note: IndexedNote, query: string = ""): NoteQuickPickItem {
  return {
    label: `$(file) ${note.metadata.title}`,
    description: note.relativePath,
    detail: buildNoteSearchDetail(note, query),
    note,
  };
}

export async function pickIndexedNote(
  notes: IndexedNote[],
  placeHolder: string,
): Promise<IndexedNote | string | undefined> {
  return new Promise<IndexedNote | string | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick<NoteQuickPickItem>();
    let resolved = false;

    const finish = (result?: IndexedNote | string) => {
      if (resolved) {
        return;
      }

      resolved = true;
      quickPick.hide();
      quickPick.dispose();
      resolve(result);
    };

    const updateItems = (query: string) => {
      const items: NoteQuickPickItem[] = notes.map((note) => toNoteQuickPickItem(note, query));
      if (query.trim()) {
        items.unshift({
          label: `$(plus) Create new note: "${query.trim()}"`,
          alwaysShow: true,
          isCreateNew: true,
          createTitle: query.trim(),
        });
      }
      quickPick.items = items;
    };

    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.placeholder = placeHolder;
    updateItems(quickPick.value);

    quickPick.onDidChangeValue((value) => {
      updateItems(value);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected?.isCreateNew && selected.createTitle) {
        finish(selected.createTitle);
      } else {
        finish(selected?.note);
      }
    });

    quickPick.onDidHide(() => {
      finish(undefined);
    });

    quickPick.show();
  });
}

export async function buildIndexedNotes(noteFiles: NoteFile[]): Promise<IndexedNote[]> {
  const results: IndexedNote[] = [];
  for (const file of noteFiles) {
    const rawContent = await fs.readFile(file.absolutePath, "utf8");
    const fallbackTitle = path.basename(file.relativePath, ".md");
    const metadata = extractNoteMetadata(rawContent, fallbackTitle);
    const preview = extractPreviewText(rawContent);
    const searchText = normalizeSearchText(stripFrontMatter(rawContent));

    results.push({
      ...file,
      metadata,
      preview,
      searchText,
    });
  }
  return results;
}

export async function createNewNote(notesDir: string, initialTitle?: string): Promise<void> {
  // Step 1: Ask for note title
  const titleInput =
    initialTitle ||
    (await vscode.window.showInputBox({
      prompt: "Enter note title (use / for subfolders)",
      placeHolder: "Meeting Notes  or  projects/ProjectX",
    }));

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
  try {
    await fs.access(targetDir);
  } catch {
    await fs.mkdir(targetDir, { recursive: true });
  }

  // Step 5: Resolve a unique file path (seconds precision + counter suffix)
  const filePath = await resolveUniqueFilePath(targetDir, filename);
  try {
    await fs.access(filePath);
    const overwrite = await vscode.window.showWarningMessage(
      `File "${path.basename(filePath)}" already exists. Overwrite?`,
      "Yes",
      "No",
    );
    if (overwrite !== "Yes") {
      return;
    }
  } catch {
    // File doesn't exist, proceed normally
  }

  await fs.writeFile(filePath, "", "utf8");

  // Step 6: Open the file
  const doc = await vscode.workspace.openTextDocument(filePath);
  const editor = await vscode.window.showTextDocument(doc);

  // Step 7: Insert snippet template
  const config = vscode.workspace.getConfiguration("notes");
  const defaultSnippet = config.get<{ langId: string; name: string }>("defaultSnippet");
  const templates = config.get<string[]>("templates") || [];

  if (!shouldPromptForTemplateSelection(templates)) {
    if (defaultSnippet?.name) {
      const langId = defaultSnippet.langId || "markdown";
      await insertSnippetByName(editor, langId, defaultSnippet.name);
    }
    vscode.window.showInformationMessage(`Note created: ${path.basename(filePath)}`);
    return;
  }

  // Show the picker only when custom templates are configured.
  const templateItems: vscode.QuickPickItem[] = [
    { label: "$(file) Default", description: "Use default template" },
    { label: "$(file-text) Empty", description: "No template" },
    ...templates.map((t) => ({
      label: `$(file-code) ${t}`,
      description: `${SNIPPET_PREFIX}${t}`,
    })),
  ];

  const selected = await vscode.window.showQuickPick(templateItems, {
    placeHolder: "Select a template",
  });

  if (!selected || selected.label.includes("Default")) {
    // Default or Esc: use default snippet
    if (defaultSnippet?.name) {
      const langId = defaultSnippet.langId || "markdown";
      await insertSnippetByName(editor, langId, defaultSnippet.name);
    }
  } else if (!selected.label.includes("Empty")) {
    // Custom template selected
    const templateName = selected.label.replace("$(file-code) ", "");
    const snippetName = `${SNIPPET_PREFIX}${templateName}`;
    const langId = defaultSnippet?.langId || "markdown";
    await insertSnippetByName(editor, langId, snippetName);
  }
  // "Empty" selected: do nothing (empty file)

  vscode.window.showInformationMessage(`Note created: ${path.basename(filePath)}`);
}

const DAILY_NOTE_DEFAULT_TEMPLATE = "# {date}\n\n## Tasks\n\n## Notes\n\n## Journal\n";

export function formatDateYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeHM(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getWeekdayName(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function applyDailyNoteTokens(template: string, date: Date): string {
  return template
    .replace(/\{date\}/g, formatDateYMD(date))
    .replace(/\{weekday\}/g, getWeekdayName(date))
    .replace(/\{time\}/g, formatTimeHM(date));
}

export async function buildDailyNoteContent(
  dateStr: string,
  templatePath: string | undefined,
  notesDir: string,
): Promise<string> {
  const now = new Date();

  if (templatePath) {
    const resolvedPath = path.isAbsolute(templatePath)
      ? templatePath
      : path.join(notesDir, templatePath);

    try {
      await fs.access(resolvedPath);
      const raw = await fs.readFile(resolvedPath, "utf8");
      return applyDailyNoteTokens(raw, now);
    } catch {
      // Template file doesn't exist, use default
    }
  }

  return applyDailyNoteTokens(DAILY_NOTE_DEFAULT_TEMPLATE, now);
}

export async function openDailyNote(notesDir: string, templatePath?: string): Promise<void> {
  const today = formatDateYMD(new Date());
  const fileName = `${today}_daily.md`;
  const filePath = path.join(notesDir, fileName);

  try {
    await fs.access(filePath);
  } catch {
    const content = await buildDailyNoteContent(today, templatePath, notesDir);
    await fs.writeFile(filePath, content, "utf8");
  }

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);
}

export async function listNotes(notesDir: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("notes");
  const momentsSubfolder = config.get<string>("momentsSubfolder") || "moments";
  const noteFiles = await collectNoteFiles(notesDir, notesDir, [momentsSubfolder]);

  if (noteFiles.length === 0) {
    vscode.window.showInformationMessage("No notes found.");
    return;
  }

  // Sort by modification time, newest first
  noteFiles.sort((a, b) => b.mtime - a.mtime);

  const indexedNotes = await buildIndexedNotes(noteFiles);
  const selected = await pickIndexedNote(
    indexedNotes,
    `${noteFiles.length} notes found. Search by title, path, tag, or body text.`,
  );

  if (selected) {
    if (typeof selected === "string") {
      await createNewNote(notesDir, selected);
    } else {
      const doc = await vscode.workspace.openTextDocument(selected.absolutePath);
      await vscode.window.showTextDocument(doc);
    }
  }
}

interface NoteFile {
  relativePath: string;
  absolutePath: string;
  mtime: number;
}

export async function collectNoteFiles(
  baseDir: string,
  currentDir: string,
  excludeDirs: string[] = [],
): Promise<NoteFile[]> {
  const results: NoteFile[] = [];

  try {
    await fs.access(currentDir);
  } catch {
    return results;
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    // Skip hidden directories
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory()) {
      // Skip excluded directories (e.g. the moments subfolder)
      if (excludeDirs.includes(entry.name)) {
        continue;
      }
      results.push(...(await collectNoteFiles(baseDir, fullPath, excludeDirs)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const stat = await fs.stat(fullPath);
      results.push({
        relativePath: path.relative(baseDir, fullPath),
        absolutePath: fullPath,
        mtime: stat.mtimeMs,
      });
    }
  }

  return results;
}
