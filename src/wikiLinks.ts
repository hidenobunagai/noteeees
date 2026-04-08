import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// Regex to find [[...]] links
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

// --- Pure helpers ---

export function parseWikiLinks(text: string): string[] {
  return [...text.matchAll(WIKI_LINK_RE)].map((m) => m[1]);
}

function getAllNoteFiles(notesDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  }

  walk(notesDir);
  return results;
}

function stripDatePrefix(stem: string): string {
  const match = stem.match(
    /^(\d{4}[-_]\d{2}[-_]\d{2}(?:[-_]\d{2}[-_]\d{2}(?:[-_]\d{2})?)?)[-_ ](.*)/,
  );
  return match?.[2] ?? stem;
}

function resolveWikiLinkFromFiles(title: string, files: string[]): string | undefined {
  const titleLower = title.toLowerCase();

  for (const file of files) {
    if (path.basename(file) === title + ".md") {
      return file;
    }
  }
  for (const file of files) {
    const stem = path.basename(file, ".md");
    if (stem.endsWith("_" + title)) {
      return file;
    }
  }
  for (const file of files) {
    if (path.basename(file).toLowerCase() === titleLower + ".md") {
      return file;
    }
  }
  for (const file of files) {
    const stem = path.basename(file, ".md").toLowerCase();
    if (stem.endsWith("_" + titleLower)) {
      return file;
    }
  }
  return undefined;
}

export function resolveWikiLinkPath(title: string, notesDir: string): string | undefined {
  return resolveWikiLinkFromFiles(title, getAllNoteFiles(notesDir));
}

// --- DocumentLinkProvider ---

export class WikiLinkDocumentLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private getNotesDir: () => string | undefined) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const notesDir = this.getNotesDir();
    if (!notesDir) {
      return [];
    }

    const text = document.getText();
    const links: vscode.DocumentLink[] = [];

    for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const title = match[1];
      const filePath = resolveWikiLinkPath(title, notesDir);
      if (!filePath) {
        continue;
      }

      const start = document.positionAt(match.index!);
      const end = document.positionAt(match.index! + match[0].length);
      const link = new vscode.DocumentLink(new vscode.Range(start, end), vscode.Uri.file(filePath));
      link.tooltip = `Open: ${path.basename(filePath)}`;
      links.push(link);
    }

    return links;
  }
}

// --- CompletionItemProvider ---

export class WikiLinkCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private getNotesDir: () => string | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const notesDir = this.getNotesDir();
    if (!notesDir) {
      return;
    }

    const lineText = document.lineAt(position).text;
    const textBefore = lineText.substring(0, position.character);
    if (!textBefore.endsWith("[[")) {
      return;
    }

    const files = getAllNoteFiles(notesDir);
    const currentFile = document.uri.fsPath;

    return files
      .filter((f) => f !== currentFile)
      .map((f) => {
        const stem = path.basename(f, ".md");
        const title = stripDatePrefix(stem);
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

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Definition | undefined {
    const notesDir = this.getNotesDir();
    if (!notesDir) {
      return;
    }

    const range = document.getWordRangeAtPosition(position, /\[\[([^\]]+)\]\]/);
    if (!range) {
      return;
    }

    const text = document.getText(range);
    const match = text.match(/\[\[([^\]]+)\]\]/);
    if (!match) {
      return;
    }

    const filePath = resolveWikiLinkPath(match[1], notesDir);
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

export function collectBacklinks(
  targetFile: string,
  notesDir: string,
): Map<string, BacklinkItem[]> {
  const files = getAllNoteFiles(notesDir);
  const result = new Map<string, BacklinkItem[]>();

  for (const file of files) {
    if (file === targetFile) {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    const items: BacklinkItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      for (const match of lines[i].matchAll(/\[\[([^\]]+)\]\]/g)) {
        if (resolveWikiLinkFromFiles(match[1], files) === targetFile) {
          items.push({ sourceFile: file, linkText: match[0], lineNumber: i });
        }
      }
    }

    if (items.length > 0) {
      result.set(file, items);
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
          title: "Open",
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

  getChildren(element?: BacklinkTreeItem): BacklinkTreeItem[] {
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

      const backlinks = collectBacklinks(currentFile, notesDir);

      return [...backlinks.entries()].map(([file, items]) => {
        const title = stripDatePrefix(path.basename(file, ".md"));
        return new BacklinkTreeItem({
          label: title,
          kind: "file",
          sourceFile: file,
          fileBacklinks: items,
          description: `${items.length} link${items.length === 1 ? "" : "s"}`,
        });
      });
    }

    if (element.kind === "file" && element.fileBacklinks) {
      return element.fileBacklinks.map((item) => {
        return new BacklinkTreeItem({
          label: `Line ${item.lineNumber + 1}: ${item.linkText}`,
          kind: "line",
          sourceFile: element.sourceFile,
          lineNumber: item.lineNumber,
        });
      });
    }

    return [];
  }
}
