import * as vscode from "vscode";
import { parseMemoryFile } from "./searchCommand";
import { extractTagsFromMemory } from "./tagCompletion";

interface TagTreeItem extends vscode.TreeItem {
  tag?: string;
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

  getChildren(element?: TagTreeItem): TagTreeItem[] {
    const memoryPath = this.getMemoryPath();
    if (!memoryPath) {
      return [];
    }

    if (!element) {
      // Root level: show tags
      const tags = extractTagsFromMemory(memoryPath);
      return tags.map((tag) => {
        const item: TagTreeItem = {
          label: tag,
          tag,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          iconPath: new vscode.ThemeIcon("tag"),
        };
        return item;
      });
    }

    // Child level: show entries for this tag
    if (element.tag) {
      const entries = parseMemoryFile(memoryPath);
      const filtered = entries.filter((e) => e.tags.includes(element.tag!));

      return filtered.map((entry) => {
        const item: TagTreeItem = {
          label: entry.dateTime,
          description: entry.content.substring(0, 40).replace(/\n/g, " "),
          entryLine: entry.line,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          iconPath: new vscode.ThemeIcon("note"),
          command: {
            command: "notes.goToLine",
            title: "Go to Entry",
            arguments: [entry.line],
          },
        };
        return item;
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
