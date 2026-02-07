import * as vscode from "vscode";
import * as fs from "fs";
import { extractTagsFromMemory } from "./tagCompletion";

export interface MemoryEntry {
  line: number;
  dateTime: string;
  tags: string[];
  content: string;
}

export function parseMemoryFile(memoryPath: string): MemoryEntry[] {
  if (!fs.existsSync(memoryPath)) {
    return [];
  }

  const content = fs.readFileSync(memoryPath, "utf8");
  const lines = content.split("\n");
  const entries: MemoryEntry[] = [];

  let currentEntry: MemoryEntry | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match entry header: ## YYYY-MM-DD HH:mm #tag1 #tag2
    const headerMatch = line.match(/^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)(.*)$/);

    if (headerMatch) {
      // Save previous entry
      if (currentEntry) {
        entries.push(currentEntry);
      }

      const dateTime = headerMatch[1];
      const tagsPart = headerMatch[2];
      const tags = (tagsPart.match(/#[\w-]+/g) || []);

      currentEntry = {
        line: i,
        dateTime,
        tags,
        content: "",
      };
    } else if (currentEntry && line.trim() && !line.startsWith("# ")) {
      currentEntry.content += (currentEntry.content ? "\n" : "") + line;
    }
  }

  // Add last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

export async function showSearchQuickPick(memoryPath: string): Promise<void> {
  const entries = parseMemoryFile(memoryPath);
  const tags = extractTagsFromMemory(memoryPath);

  // Create filter options
  const filterOptions: vscode.QuickPickItem[] = [
    { label: "$(search) Show All Entries", description: `${entries.length} entries` },
    { label: "$(calendar) Filter by Date", description: "Enter date range" },
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    ...tags.map((tag) => ({
      label: `$(tag) ${tag}`,
      description: `Filter by tag`,
    })),
  ];

  const selected = await vscode.window.showQuickPick(filterOptions, {
    placeHolder: "Search notes by tag or date",
  });

  if (!selected) {
    return;
  }

  let filteredEntries = entries;

  if (selected.label.startsWith("$(tag)")) {
    const tag = selected.label.replace("$(tag) ", "");
    filteredEntries = entries.filter((e) => e.tags.includes(tag));
  } else if (selected.label.includes("Filter by Date")) {
    const dateInput = await vscode.window.showInputBox({
      prompt: "Enter date (YYYY-MM-DD) or date range (YYYY-MM-DD to YYYY-MM-DD)",
      placeHolder: "2026-01-31",
    });

    if (!dateInput) {
      return;
    }

    const rangeParts = dateInput.split(" to ");
    if (rangeParts.length === 2) {
      const [start, end] = rangeParts;
      filteredEntries = entries.filter(
        (e) => e.dateTime >= start && e.dateTime <= end + " 23:59"
      );
    } else {
      filteredEntries = entries.filter((e) => e.dateTime.startsWith(dateInput));
    }
  }

  // Show filtered entries
  if (filteredEntries.length === 0) {
    vscode.window.showInformationMessage("No entries found.");
    return;
  }

  const entryItems: vscode.QuickPickItem[] = filteredEntries.map((entry) => ({
    label: `${entry.dateTime} ${entry.tags.join(" ")}`,
    description: entry.content.substring(0, 80).replace(/\n/g, " "),
    detail: `Line ${entry.line + 1}`,
  }));

  const selectedEntry = await vscode.window.showQuickPick(entryItems, {
    placeHolder: `Found ${filteredEntries.length} entries`,
  });

  if (selectedEntry) {
    // Open file and go to line
    const doc = await vscode.workspace.openTextDocument(memoryPath);
    const editor = await vscode.window.showTextDocument(doc);
    const lineNum = parseInt(selectedEntry.detail?.replace("Line ", "") || "1") - 1;
    const position = new vscode.Position(lineNum, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}
