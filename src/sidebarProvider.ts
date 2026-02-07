import * as vscode from "vscode";
import { parseMemoryFile } from "./searchCommand";
import { extractTagsFromMemory } from "./tagCompletion";

interface TagTreeItem extends vscode.TreeItem {
  kind: "root" | "tagsRoot" | "structureRoot" | "tag" | "month" | "monthTag" | "entry";
  tag?: string;
  month?: string;
  entryLine?: number;
}

export class NotesTreeProvider implements vscode.TreeDataProvider<TagTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TagTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private getMemoryPath: () => string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TagTreeItem): vscode.TreeItem {
    return element;
  }

  private createEntryTreeItem(entry: ReturnType<typeof parseMemoryFile>[number], description: string): TagTreeItem {
    return {
      label: entry.dateTime,
      description,
      kind: "entry",
      entryLine: entry.line,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      iconPath: new vscode.ThemeIcon("note"),
      command: {
        command: "notes.goToLine",
        title: "Go to Entry",
        arguments: [entry.line],
      },
    };
  }

  getChildren(element?: TagTreeItem): TagTreeItem[] {
    const memoryPath = this.getMemoryPath();
    if (!memoryPath) {
      return [];
    }

    if (!element) {
      // Root level: show two navigation modes
      return [
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
      ];
    }

    if (element.kind === "tagsRoot") {
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

    if (element.kind === "structureRoot") {
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

    if (element.kind === "month" && element.month) {
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

    if (element.kind === "monthTag" && element.month && element.tag) {
      const month = element.month;
      const tag = element.tag;
      const entries = parseMemoryFile(memoryPath);
      const filtered = entries
        .filter((entry) => entry.dateTime.startsWith(month) && entry.tags.includes(tag))
        .sort((a, b) => b.dateTime.localeCompare(a.dateTime));

      return filtered.map((entry) => this.createEntryTreeItem(entry, entry.content.substring(0, 40).replace(/\n/g, " ")));
    }

    // Child level: show entries for this tag
    if (element.kind === "tag" && element.tag) {
      const entries = parseMemoryFile(memoryPath);
      const filtered = entries.filter((e) => e.tags.includes(element.tag!));

      return filtered.map((entry) => {
        return this.createEntryTreeItem(entry, entry.content.substring(0, 40).replace(/\n/g, " "));
      });
    }

    return [];
  }
}

export function registerGoToLineCommand(context: vscode.ExtensionContext, getMemoryPath: () => string | undefined) {
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
