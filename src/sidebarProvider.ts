import * as path from "path";
import * as vscode from "vscode";
import {
  getMemoryEntryPreview,
  parseMemoryFile,
  parseMemoryText,
  updateMemoryEntryCheckbox,
} from "./memoryEntries";
import { collectNoteFiles } from "./noteCommands";
import { extractTagsFromMemory } from "./tagCompletion";

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

interface TagTreeItem extends vscode.TreeItem {
  kind:
    | "root"
    | "tagsRoot"
    | "structureRoot"
    | "notesRoot"
    | "noteFile"
    | "tag"
    | "month"
    | "monthTag"
    | "entry";
  tag?: string;
  month?: string;
  entryLine?: number;
  entryDateTime?: string;
  entryHeaderTail?: string;
  filePath?: string;
}

export class NotesTreeProvider implements vscode.TreeDataProvider<TagTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TagTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private getMemoryPath: () => string | undefined,
    private getNotesDir: () => string | undefined,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TagTreeItem): vscode.TreeItem {
    return element;
  }

  private createEntryTreeItem(
    entry: ReturnType<typeof parseMemoryFile>[number],
  ): TagTreeItem {
    const preview = getMemoryEntryPreview(entry.content, 40);
    const description = preview || entry.tags.join(" ");

    return {
      label: entry.dateTime,
      description: description || undefined,
      kind: "entry",
      entryLine: entry.line,
      entryDateTime: entry.dateTime,
      entryHeaderTail: entry.headerTail,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      checkboxState: entry.checked
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked,
      command: {
        command: "notes.goToLine",
        title: "Go to Entry",
        arguments: [entry.line],
      },
    };
  }

  async updateEntryCheckboxes(
    changes: ReadonlyArray<[TagTreeItem, vscode.TreeItemCheckboxState]>,
  ): Promise<void> {
    const memoryPath = this.getMemoryPath();
    if (!memoryPath) {
      vscode.window.showErrorMessage("Notes directory is not configured. Run 'Notes: Run Setup' first.");
      return;
    }

    const document = await vscode.workspace.openTextDocument(memoryPath);
    const entries = parseMemoryText(document.getText());
    const edit = new vscode.WorkspaceEdit();
    let hasChanges = false;

    for (const [item, checkboxState] of changes) {
      if (
        item.kind !== "entry" ||
        item.entryLine === undefined ||
        !item.entryDateTime ||
        item.entryHeaderTail === undefined
      ) {
        continue;
      }

      const matchingEntry =
        entries.find(
          (entry) =>
            entry.line === item.entryLine &&
            entry.dateTime === item.entryDateTime &&
            entry.headerTail === item.entryHeaderTail,
        ) ||
        entries.find(
          (entry) =>
            entry.dateTime === item.entryDateTime && entry.headerTail === item.entryHeaderTail,
        );

      if (!matchingEntry) {
        vscode.window.showErrorMessage(
          "Could not find the selected post. Refresh the sidebar and try again.",
        );
        continue;
      }

      const updatedLine = updateMemoryEntryCheckbox(
        document.lineAt(matchingEntry.line).text,
        checkboxState === vscode.TreeItemCheckboxState.Checked,
      );

      if (!updatedLine) {
        vscode.window.showErrorMessage(
          "Could not update the selected post. Refresh the sidebar and try again.",
        );
        continue;
      }

      if (updatedLine !== document.lineAt(matchingEntry.line).text) {
        edit.replace(document.uri, document.lineAt(matchingEntry.line).range, updatedLine);
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return;
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      vscode.window.showErrorMessage("Could not apply the checkbox update to memory.md.");
      return;
    }

    const saved = await document.save();
    if (!saved) {
      vscode.window.showErrorMessage("Could not save memory.md after updating the selected post.");
      return;
    }

    this.refresh();
  }

  getChildren(element?: TagTreeItem): TagTreeItem[] {
    const memoryPath = this.getMemoryPath();
    const notesDir = this.getNotesDir();

    if (!memoryPath && !notesDir) {
      return [];
    }

    if (!element) {
      // Root level: show three navigation modes
      const roots: TagTreeItem[] = [];

      if (notesDir) {
        roots.push({
          label: "Notes",
          kind: "notesRoot",
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          iconPath: new vscode.ThemeIcon("files"),
        });
      }

      if (memoryPath) {
        roots.push(
          {
            label: "Tags",
            kind: "tagsRoot",
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            iconPath: new vscode.ThemeIcon("tag"),
          },
          {
            label: "Structure",
            kind: "structureRoot",
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            iconPath: new vscode.ThemeIcon("list-tree"),
          },
        );
      }

      return roots;
    }

    if (element.kind === "notesRoot" && notesDir) {
      const noteFiles = collectNoteFiles(notesDir, notesDir);
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

    if (element.kind === "tagsRoot" && memoryPath) {
      const tags = extractTagsFromMemory(memoryPath);
      return tags.map((tag) => {
        const item: TagTreeItem = {
          label: tag,
          kind: "tag",
          tag,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          iconPath: new vscode.ThemeIcon("tag"),
        };
        return item;
      });
    }

    if (element.kind === "structureRoot" && memoryPath) {
      const entries = parseMemoryFile(memoryPath);
      const months = [...new Set(entries.map((entry) => entry.dateTime.slice(0, 7)))];

      return months.map((month) => ({
        label: month,
        kind: "month",
        month,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        iconPath: new vscode.ThemeIcon("calendar"),
      }));
    }

    if (element.kind === "month" && element.month && memoryPath) {
      const month = element.month;
      const entries = parseMemoryFile(memoryPath);
      const filtered = entries.filter((entry) => entry.dateTime.startsWith(month));
      const tags = [...new Set(filtered.flatMap((entry) => entry.tags))].sort();

      return tags.map((tag) => ({
        label: tag,
        kind: "monthTag",
        month,
        tag,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        iconPath: new vscode.ThemeIcon("tag"),
      }));
    }

    if (element.kind === "monthTag" && element.month && element.tag && memoryPath) {
      const month = element.month;
      const tag = element.tag;
      const entries = parseMemoryFile(memoryPath);
      const filtered = entries
        .filter((entry) => entry.dateTime.startsWith(month) && entry.tags.includes(tag))
        .sort((a, b) => b.dateTime.localeCompare(a.dateTime));

      return filtered.map((entry) =>
        this.createEntryTreeItem(entry),
      );
    }

    // Child level: show entries for this tag
    if (element.kind === "tag" && element.tag && memoryPath) {
      const entries = parseMemoryFile(memoryPath);
      const filtered = entries.filter((e) => e.tags.includes(element.tag!));

      return filtered.map((entry) => {
        return this.createEntryTreeItem(entry);
      });
    }

    return [];
  }
}

export function registerGoToLineCommand(
  context: vscode.ExtensionContext,
  getMemoryPath: () => string | undefined,
) {
  const disposable = vscode.commands.registerCommand("notes.goToLine", async (line: number) => {
    const memoryPath = getMemoryPath();
    if (!memoryPath) {
      return;
    }

    const doc = await vscode.workspace.openTextDocument(memoryPath);
    const editor = await vscode.window.showTextDocument(doc);
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  });

  context.subscriptions.push(disposable);
}
