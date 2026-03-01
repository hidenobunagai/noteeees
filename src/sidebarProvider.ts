import * as path from "path";
import * as vscode from "vscode";
import { collectNoteFiles } from "./noteCommands";

/**
 * Strip a leading date/datetime prefix from a filename stem.
 * Recognised patterns (separator = '-' or '_'):
 *   YYYY-MM-DD_HH-mm_  (e.g. 2026-02-11_15-40_)
 *   YYYY-MM-DD_HH-mm-ss_ (with seconds)
 *   YYYY-MM-DD_  or  YYYY_MM_DD_
 *   YYYY-MM-DD   (followed by space)
 * Returns { title, datePrefix } where datePrefix is the matched date string
 * (without trailing separator), or empty string if none matched.
 */
function stripDatePrefix(basename: string): { title: string; datePrefix: string } {
  const match = basename.match(
    /^(\d{4}[-_]\d{2}[-_]\d{2}(?:[-_]\d{2}[-_]\d{2}(?:[-_]\d{2})?)?)[-_ ](.*)/,
  );
  if (match && match[2]) {
    return { title: match[2], datePrefix: match[1] };
  }
  return { title: basename, datePrefix: "" };
}

interface NoteTreeItem extends vscode.TreeItem {
  kind: "notesRoot" | "noteFile";
  filePath?: string;
}

export class NotesTreeProvider implements vscode.TreeDataProvider<NoteTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NoteTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private getNotesDir: () => string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: NoteTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: NoteTreeItem): NoteTreeItem[] {
    const notesDir = this.getNotesDir();

    if (!notesDir) {
      return [];
    }

    if (!element) {
      return [
        {
          label: "Notes",
          kind: "notesRoot",
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          iconPath: new vscode.ThemeIcon("files"),
        },
      ];
    }

    if (element.kind === "notesRoot") {
      const config = vscode.workspace.getConfiguration("notes");
      const momentsSubfolder = config.get<string>("momentsSubfolder") || "moments";
      const noteFiles = collectNoteFiles(notesDir, notesDir, [momentsSubfolder]);
      noteFiles.sort((a, b) => b.mtime - a.mtime);

      return noteFiles.map((f) => {
        const basename = path.basename(f.relativePath, ".md");
        const { title, datePrefix } = stripDatePrefix(basename);
        const subDir = f.relativePath.includes(path.sep) ? path.dirname(f.relativePath) : undefined;
        const descParts = [datePrefix, subDir].filter(Boolean);

        return {
          label: title,
          description: descParts.length > 0 ? descParts.join(" • ") : undefined,
          tooltip: basename,
          kind: "noteFile" as const,
          filePath: f.absolutePath,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          iconPath: new vscode.ThemeIcon("file"),
          command: {
            command: "notes.openNoteFile",
            title: "Open Note",
            arguments: [f.absolutePath],
          },
        };
      });
    }

    return [];
  }
}

