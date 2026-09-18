import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { collectNoteFiles } from "../shared/collectNoteFiles.js";
import { stripDatePrefixTitle } from "../shared/noteFilename.js";
import { t } from "./i18n.js";

// Regex to find [[...]] links (supports [[Target|Alias]])
const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

// --- Pure helpers ---

export function parseWikiLinks(text: string): string[] {
  return [...text.matchAll(WIKI_LINK_RE)].map((m) => m[1]);
}

type NoteFileCache = {
  files: Array<{ filePath: string; mtime: number }>;
  signature: string;
};

/**
 * Keyed by notes directory: identical relative paths and mtimes can occur in
 * different directories (e.g. a copied notes folder), so a signature of
 * path+mtime alone is not unique across directories.
 */
const noteFileCache = new Map<string, NoteFileCache>();

/** Returns note files with mtimes, cached by a path+mtime signature. */
async function getAllNoteFilesWithMtime(
  notesDir: string,
): Promise<Array<{ filePath: string; mtime: number }>> {
  const collected = await collectNoteFiles(notesDir);
  const signature = collected.map((f) => `${f.relativePath}:${f.mtime}`).join("|");
  const cached = noteFileCache.get(notesDir);
  if (cached?.signature === signature) {
    return cached.files;
  }

  const files = collected.map((f) => ({ filePath: f.filePath, mtime: f.mtime }));
  noteFileCache.set(notesDir, { files, signature });
  return files;
}

async function getAllNoteFiles(notesDir: string): Promise<string[]> {
  return (await getAllNoteFilesWithMtime(notesDir)).map((f) => f.filePath);
}

export class WikiLinkIndex {
  private readonly byName = new Map<string, string>();
  private readonly byLowerName = new Map<string, string>();
  private readonly bySuffix = new Map<string, string>();
  private readonly byLowerSuffix = new Map<string, string>();
  private readonly cache = new Map<string, string | undefined>();

  constructor(files: string[]) {
    for (const file of files) {
      const base = path.basename(file);
      const stem = path.basename(file, ".md");

      if (!this.byName.has(base)) {
        this.byName.set(base, file);
      }

      const lowerBase = base.toLowerCase();
      if (!this.byLowerName.has(lowerBase)) {
        this.byLowerName.set(lowerBase, file);
      }

      // The old scan matched `stem.endsWith("_" + title)`, so every suffix that
      // starts right after an underscore is a candidate ("a_b_Daily" -> "b_Daily", "Daily").
      const stemLower = stem.toLowerCase();
      let i = stem.indexOf("_");
      while (i !== -1) {
        const suffix = stem.slice(i + 1);
        if (!this.bySuffix.has(suffix)) {
          this.bySuffix.set(suffix, file);
        }
        const lowerSuffix = stemLower.slice(i + 1);
        if (!this.byLowerSuffix.has(lowerSuffix)) {
          this.byLowerSuffix.set(lowerSuffix, file);
        }
        i = stem.indexOf("_", i + 1);
      }
    }
  }

  /** One probe chain against the prebuilt index, without memoization. */
  lookup(title: string): string | undefined {
    const titleLower = title.toLowerCase();
    return (
      this.byName.get(title + ".md") ??
      this.bySuffix.get(title) ??
      this.byLowerName.get(titleLower + ".md") ??
      this.byLowerSuffix.get(titleLower)
    );
  }

  /** Memoized lookup so a scan resolves each distinct title only once. */
  resolve(title: string): string | undefined {
    if (!this.cache.has(title)) {
      this.cache.set(title, this.lookup(title));
    }
    return this.cache.get(title);
  }
}

export async function resolveWikiLinkPath(
  title: string,
  notesDir: string,
): Promise<string | undefined> {
  const index = new WikiLinkIndex(await getAllNoteFiles(notesDir));
  return index.lookup(title);
}

// --- DocumentLinkProvider ---

export class WikiLinkDocumentLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private getNotesDir: () => string | undefined) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const notesDir = this.getNotesDir();
    if (!notesDir) {
      return [];
    }

    const text = document.getText();
    const links: vscode.DocumentLink[] = [];
    const index = new WikiLinkIndex(await getAllNoteFiles(notesDir));

    for (const match of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
      const title = match[1];
      const filePath = index.resolve(title);
      if (!filePath) {
        continue;
      }

      const start = document.positionAt(match.index!);
      const end = document.positionAt(match.index! + match[0].length);
      const link = new vscode.DocumentLink(new vscode.Range(start, end), vscode.Uri.file(filePath));
      link.tooltip = t("openTooltip", { name: path.basename(filePath) });
      links.push(link);
    }

    return links;
  }
}

// --- CompletionItemProvider ---

export class WikiLinkCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private getNotesDir: () => string | undefined) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const notesDir = this.getNotesDir();
    if (!notesDir) {
      return;
    }

    const lineText = document.lineAt(position).text;
    const textBefore = lineText.substring(0, position.character);
    if (!textBefore.endsWith("[[")) {
      return;
    }

    const files = await getAllNoteFiles(notesDir);
    const currentFile = document.uri.fsPath;

    return files
      .filter((f) => f !== currentFile)
      .map((f) => {
        const stem = path.basename(f, ".md");
        const title = stripDatePrefixTitle(stem);
        const relativePath = path.relative(notesDir, f);

        const item = new vscode.CompletionItem(title, vscode.CompletionItemKind.Reference);
        item.insertText = title;
        item.detail = relativePath;
        return item;
      });
  }
}

// --- DefinitionProvider ---

export class WikiLinkDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private getNotesDir: () => string | undefined) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Definition | undefined> {
    const notesDir = this.getNotesDir();
    if (!notesDir) {
      return;
    }

    const range = document.getWordRangeAtPosition(position, /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/);
    if (!range) {
      return;
    }

    const text = document.getText(range);
    const match = text.match(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/);
    if (!match) {
      return;
    }

    const filePath = await resolveWikiLinkPath(match[1], notesDir);
    if (!filePath) {
      return;
    }

    return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
  }
}

// --- Backlinks Tree ---

export interface BacklinkItem {
  sourceFile: string;
  linkText: string;
  lineNumber: number;
}

/**
 * mtime-keyed cache of file contents so backlink scans don't re-read every
 * note when only a few files changed (or nothing changed).
 */
const backlinkContentCache = new Map<string, { mtime: number; content: string }>();

export async function collectBacklinks(
  targetFile: string,
  notesDir: string,
): Promise<Map<string, BacklinkItem[]>> {
  const collected = await getAllNoteFilesWithMtime(notesDir);
  const files = collected.map((f) => f.filePath);
  const mtimes = new Map(collected.map((f) => [f.filePath, f.mtime]));
  const result = new Map<string, BacklinkItem[]>();

  const index = new WikiLinkIndex(files);

  for (const file of files) {
    if (file === targetFile) {
      continue;
    }

    const mtime = mtimes.get(file)!;
    const cached = backlinkContentCache.get(file);
    let content: string;
    if (cached && cached.mtime === mtime) {
      content = cached.content;
    } else {
      try {
        content = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      backlinkContentCache.set(file, { mtime, content });
    }

    const lines = content.split("\n");
    const items: BacklinkItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      for (const match of lines[i].matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
        if (index.resolve(match[1]) === targetFile) {
          items.push({ sourceFile: file, linkText: match[0], lineNumber: i });
        }
      }
    }

    if (items.length > 0) {
      result.set(file, items);
    }
  }

  // Drop cache entries for deleted files.
  for (const cachedFile of backlinkContentCache.keys()) {
    if (!mtimes.has(cachedFile)) {
      backlinkContentCache.delete(cachedFile);
    }
  }

  return result;
}

type BacklinkTreeItemKind = "file" | "line";

class BacklinkTreeItem extends vscode.TreeItem {
  readonly kind: BacklinkTreeItemKind;
  readonly sourceFile: string;
  readonly lineNumber: number | undefined;
  readonly fileBacklinks: BacklinkItem[] | undefined;

  constructor(opts: {
    label: string;
    kind: BacklinkTreeItemKind;
    sourceFile: string;
    lineNumber?: number;
    fileBacklinks?: BacklinkItem[];
    description?: string;
  }) {
    super(
      opts.label,
      opts.kind === "file"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.kind = opts.kind;
    this.sourceFile = opts.sourceFile;
    this.lineNumber = opts.lineNumber;
    this.fileBacklinks = opts.fileBacklinks;

    if (opts.description !== undefined) {
      this.description = opts.description;
    }

    if (opts.kind === "file") {
      this.iconPath = new vscode.ThemeIcon("file");
    } else {
      this.iconPath = new vscode.ThemeIcon("arrow-right");
      if (opts.lineNumber !== undefined) {
        this.command = {
          command: "vscode.open",
          title: t("openBtn"),
          arguments: [
            vscode.Uri.file(opts.sourceFile),
            { selection: new vscode.Range(opts.lineNumber, 0, opts.lineNumber, 0) },
          ],
        };
      }
    }
  }
}

export class BacklinksProvider implements vscode.TreeDataProvider<BacklinkTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private getNotesDir: () => string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BacklinkTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BacklinkTreeItem): Promise<BacklinkTreeItem[]> {
    const notesDir = this.getNotesDir();
    if (!notesDir) {
      return [];
    }

    if (!element) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return [];
      }

      const currentFile = activeEditor.document.uri.fsPath;
      if (!currentFile.endsWith(".md")) {
        return [];
      }

      const backlinks = await collectBacklinks(currentFile, notesDir);

      return [...backlinks.entries()].map(([file, items]) => {
        const title = stripDatePrefixTitle(path.basename(file, ".md"));
        return new BacklinkTreeItem({
          label: title,
          kind: "file",
          sourceFile: file,
          fileBacklinks: items,
          description: t("backlinkCount", { count: items.length }),
        });
      });
    }

    if (element.kind === "file" && element.fileBacklinks) {
      return element.fileBacklinks.map((item) => {
        return new BacklinkTreeItem({
          label: t("backlinkLine", { line: item.lineNumber + 1, text: item.linkText }),
          kind: "line",
          sourceFile: element.sourceFile,
          lineNumber: item.lineNumber,
        });
      });
    }

    return [];
  }
}
