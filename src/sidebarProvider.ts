import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildIndexedNotes, collectNoteFiles, type IndexedNote } from "./noteCommands";

export type SidebarTagSortMode = "frequency" | "alphabetical";
export type MoveDirection = "up" | "down";

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
  kind: "pinnedRoot" | "recentRoot" | "tagsRoot" | "tagGroup" | "noteFile";
  filePath?: string;
  relativePath?: string;
  tag?: string;
}

interface SidebarNoteItem {
  title: string;
  relativePath: string;
  absolutePath: string;
  mtime: number;
  tags: string[];
  description?: string;
}

export function limitSidebarNotes<T>(notes: T[], limit: number): T[] {
  if (limit <= 0) {
    return notes;
  }
  return notes.slice(0, limit);
}

export function movePinnedItem<T>(items: T[], index: number, direction: MoveDirection): T[] {
  if (index < 0 || index >= items.length) {
    return items;
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const reordered = [...items];
  const [item] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, item);
  return reordered;
}

export function buildTagSummary(
  notes: Array<{ tags: string[] }>,
  sortMode: SidebarTagSortMode = "frequency",
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();

  for (const note of notes) {
    for (const tag of note.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const summary = [...counts.entries()].map(([tag, count]) => ({ tag, count }));

  if (sortMode === "alphabetical") {
    return summary.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  return summary.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function getRecentNotesLimit(): number {
  const config = vscode.workspace.getConfiguration("notes");
  return Math.max(0, config.get<number>("sidebarRecentLimit") ?? 20);
}

function formatTagCount(count: number): string {
  return `${count} note${count === 1 ? "" : "s"}`;
}

export class NotesTreeProvider implements vscode.TreeDataProvider<NoteTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NoteTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private getNotesDir: () => string | undefined,
    private getPinnedRelativePaths: () => string[],
    private getTagSortMode: () => SidebarTagSortMode,
  ) {}

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

    const notes = this._getSidebarNotes(notesDir);
    const pinnedRelativePaths = new Set(this.getPinnedRelativePaths());
    const pinnedNotes = notes.filter((note) => pinnedRelativePaths.has(note.relativePath));
    const unpinnedNotes = notes.filter((note) => !pinnedRelativePaths.has(note.relativePath));

    if (!element) {
      return [
        ...(pinnedNotes.length > 0
          ? [
              {
                label: "Pinned",
                kind: "pinnedRoot" as const,
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                iconPath: new vscode.ThemeIcon("pin"),
              },
            ]
          : []),
        {
          label: "Recent",
          kind: "recentRoot",
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          iconPath: new vscode.ThemeIcon("files"),
        },
        {
          label: "Tags",
          kind: "tagsRoot",
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          iconPath: new vscode.ThemeIcon("tag"),
        },
      ];
    }

    if (element.kind === "pinnedRoot") {
      return pinnedNotes.map((note) => this._createNoteTreeItem(note));
    }

    if (element.kind === "recentRoot") {
      return limitSidebarNotes(unpinnedNotes, getRecentNotesLimit()).map((note) =>
        this._createNoteTreeItem(note),
      );
    }

    if (element.kind === "tagsRoot") {
      return buildTagSummary(notes, this.getTagSortMode()).map(({ tag, count }) => ({
        label: tag,
        description: formatTagCount(count),
        tooltip: `${formatTagCount(count)} tagged ${tag}`,
        tag,
        kind: "tagGroup" as const,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        iconPath: new vscode.ThemeIcon("tag"),
      }));
    }

    if (element.kind === "tagGroup" && element.tag) {
      return notes
        .filter((note) => note.tags.includes(element.tag!))
        .map((note) => this._createNoteTreeItem(note, element.tag));
    }

    return [];
  }

  private _getSidebarNotes(notesDir: string): SidebarNoteItem[] {
    const config = vscode.workspace.getConfiguration("notes");
    const momentsSubfolder = config.get<string>("momentsSubfolder") || "moments";
    const noteFiles = collectNoteFiles(notesDir, notesDir, [momentsSubfolder]);
    const indexedNotes = buildIndexedNotes(noteFiles);

    return indexedNotes
      .sort((a, b) => b.mtime - a.mtime)
      .map((note) => this._toSidebarNoteItem(note));
  }

  private _toSidebarNoteItem(note: IndexedNote): SidebarNoteItem {
    const basename = path.basename(note.relativePath, ".md");
    const fallback = stripDatePrefix(basename);
    const subDir = note.relativePath.includes(path.sep)
      ? path.dirname(note.relativePath)
      : undefined;
    const descParts = [subDir].filter(Boolean);

    return {
      title: note.metadata.title || fallback.title,
      relativePath: note.relativePath,
      absolutePath: note.absolutePath,
      mtime: note.mtime,
      tags: note.metadata.tags,
      description: descParts.length > 0 ? descParts.join(" • ") : undefined,
    };
  }

  private _createNoteTreeItem(note: SidebarNoteItem, activeTag?: string): NoteTreeItem {
    const tagDescription = activeTag
      ? [note.relativePath, new Date(note.mtime).toLocaleDateString()].join(" • ")
      : note.description;
    const pinned = this.getPinnedRelativePaths().includes(note.relativePath);

    return {
      label: note.title,
      description: tagDescription,
      tooltip: this._buildTooltip(note),
      kind: "noteFile",
      filePath: note.absolutePath,
      relativePath: note.relativePath,
      contextValue: pinned ? "pinnedNoteFile" : "noteFile",
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      iconPath: new vscode.ThemeIcon(pinned ? "pin" : "file"),
      command: {
        command: "notes.openNoteFile",
        title: "Open Note",
        arguments: [note.absolutePath],
      },
    };
  }

  private _buildTooltip(note: SidebarNoteItem): string {
    const lines = [note.relativePath];

    if (note.tags.length > 0) {
      lines.push(note.tags.join(" "));
    }

    lines.push(`Updated ${new Date(note.mtime).toLocaleString()}`);

    const raw = fs.readFileSync(note.absolutePath, "utf8");
    const preview = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
    if (preview.length > 0) {
      lines.push(preview.slice(0, 140).replace(/\n+/g, " "));
    }

    return lines.join("\n");
  }
}
