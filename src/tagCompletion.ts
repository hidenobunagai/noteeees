import * as vscode from "vscode";
import * as fs from "fs";

export function extractTagsFromMemory(memoryPath: string): string[] {
  if (!fs.existsSync(memoryPath)) {
    return [];
  }

  const content = fs.readFileSync(memoryPath, "utf8");
  const tagMatches = content.match(/#[\w-]+/g) || [];
  const uniqueTags = [...new Set(tagMatches)];
  return uniqueTags.sort();
}

export class TagCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private getMemoryPath: () => string | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const linePrefix = lineText.substring(0, position.character);

    // Only trigger after #
    if (!linePrefix.endsWith("#") && !linePrefix.match(/#[\w-]*$/)) {
      return undefined;
    }

    const memoryPath = this.getMemoryPath();
    if (!memoryPath) {
      return undefined;
    }

    const tags = extractTagsFromMemory(memoryPath);

    return tags.map((tag) => {
      const tagName = tag.substring(1); // Remove #
      const item = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Keyword);
      item.detail = `Tag: ${tag}`;
      item.insertText = tagName;
      return item;
    });
  }
}
