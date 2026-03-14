import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildQueryExcerpt } from "../noteCommands.js";
import type { TaskOverviewItem, InboxTaskFilter } from "./types.js";
import {
  filterTaskOverviewItems,
  getConfiguredInboxTaskFilter,
  persistInboxTaskFilter,
  getNextInboxFilter,
  setLastInboxTaskFilter,
} from "./config.js";
import {
  getMomentsDirectory,
  readMoments,
  mapMomentBodyIndexToFileLine,
  toggleMomentTaskLine,
} from "./fileIo.js";

interface OpenTaskQuickPickItem extends vscode.QuickPickItem {
  task: TaskOverviewItem;
}

function compareOpenTaskOverview<T extends { date: string; time: string; done?: boolean }>(
  a: T,
  b: T,
): number {
  if ((a.done ?? false) !== (b.done ?? false)) {
    return Number(a.done ?? false) - Number(b.done ?? false);
  }

  const dateCompare = b.date.localeCompare(a.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }

  return b.time.localeCompare(a.time);
}

export function sortOpenTaskOverview<T extends { date: string; time: string; done?: boolean }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => compareOpenTaskOverview(a, b));
}

export function buildTaskSearchDetail(item: TaskOverviewItem, query: string = ""): string {
  const details = [`${item.relativePath}:${item.fileLineIndex + 1}`];
  const normalizedQuery = query.trim();

  if (normalizedQuery) {
    const excerpt = buildQueryExcerpt(
      `${item.relativePath} ${item.date} ${item.time} ${item.done ? "done" : "open"} ${item.text}`,
      normalizedQuery,
      90,
    );
    if (excerpt) {
      details.push(excerpt);
    }
  }

  return details.join("  •  ");
}

function toOpenTaskQuickPickItem(
  item: TaskOverviewItem,
  query: string = "",
): OpenTaskQuickPickItem {
  return {
    label: `$(checklist) ${item.text}`,
    description: `${item.date} • ${item.time} • ${item.done ? "Done" : "Open"}`,
    detail: buildTaskSearchDetail(item, query),
    buttons: [
      {
        iconPath: new vscode.ThemeIcon(item.done ? "circle-large-outline" : "check"),
        tooltip: item.done ? "Mark task as open" : "Mark task as done",
      },
    ],
    task: item,
  };
}

function getInboxFilterLabel(filter: InboxTaskFilter): string {
  if (filter === "open") {
    return "Open Only";
  }

  if (filter === "done") {
    return "Done Only";
  }

  if (filter === "overdue") {
    return "Overdue";
  }

  return "All Tasks";
}

function buildInboxFilterButton(filter: InboxTaskFilter): vscode.QuickInputButton {
  return {
    iconPath: new vscode.ThemeIcon("filter"),
    tooltip: `Switch inbox filter (${getInboxFilterLabel(filter)})`,
  };
}

function collectOpenTaskOverview(notesDir: string): TaskOverviewItem[] {
  const momentsDir = getMomentsDirectory(notesDir);
  if (!fs.existsSync(momentsDir)) {
    return [];
  }

  const files = fs.readdirSync(momentsDir, { withFileTypes: true });
  const items: TaskOverviewItem[] = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".md")) {
      continue;
    }

    const date = path.basename(file.name, ".md");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue;
    }

    const filePath = path.join(momentsDir, file.name);
    const raw = fs.readFileSync(filePath, "utf8");
    const entries = readMoments(notesDir, date);

    for (const entry of entries) {
      if (entry.isTask) {
        items.push({
          date,
          time: entry.time,
          text: entry.text,
          filePath,
          relativePath: path.relative(notesDir, filePath),
          fileLineIndex: mapMomentBodyIndexToFileLine(raw, entry.index),
          done: entry.done,
        });
      }
    }
  }

  return sortOpenTaskOverview(items);
}

function openOpenTaskItem(item: TaskOverviewItem): Thenable<vscode.TextEditor> {
  return vscode.workspace.openTextDocument(item.filePath).then((doc) => {
    return vscode.window.showTextDocument(doc).then((editor) => {
      const line = Math.min(item.fileLineIndex, Math.max(0, doc.lineCount - 1));
      const range = doc.lineAt(line).range;
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      return editor;
    });
  });
}

function toggleTaskAtFileLine(filePath: string, fileLineIndex: number): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  if (fileLineIndex < 0 || fileLineIndex >= lines.length) {
    return false;
  }

  const result = toggleMomentTaskLine(lines[fileLineIndex]);
  if (!result.changed) {
    return false;
  }

  lines[fileLineIndex] = result.line;
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return true;
}

export async function showOpenTasksOverview(notesDir: string): Promise<void> {
  const quickPick = vscode.window.createQuickPick<OpenTaskQuickPickItem>();
  let activeFilter: InboxTaskFilter = getConfiguredInboxTaskFilter();
  setLastInboxTaskFilter(activeFilter);
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.buttons = [buildInboxFilterButton(activeFilter)];

  const refreshItems = (query: string = quickPick.value): number => {
    const items = collectOpenTaskOverview(notesDir);
    const filteredItems = filterTaskOverviewItems(items, activeFilter);
    quickPick.title = `Moments Inbox • ${getInboxFilterLabel(activeFilter)}`;
    quickPick.buttons = [buildInboxFilterButton(activeFilter)];
    quickPick.items = filteredItems.map((item) => toOpenTaskQuickPickItem(item, query));
    const openCount = items.filter((item) => !item.done).length;
    const doneCount = items.length - openCount;

    if (filteredItems.length === 0 && items.length > 0) {
      quickPick.placeholder = `No ${getInboxFilterLabel(activeFilter).toLowerCase()} match the current filter. Type to search by text, date, state, or file.`;
    } else {
      quickPick.placeholder = `${openCount} open • ${doneCount} done across Moments. Type to filter by text, date, state, or file.`;
    }

    return items.length;
  };

  if (refreshItems() === 0) {
    quickPick.dispose();
    vscode.window.showInformationMessage("No tasks across Moments.");
    return;
  }

  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (!selected) {
      return;
    }

    void openOpenTaskItem(selected.task);
    quickPick.hide();
  });

  quickPick.onDidChangeValue((value) => {
    refreshItems(value);
  });

  quickPick.onDidTriggerButton(() => {
    activeFilter = getNextInboxFilter(activeFilter);
    void persistInboxTaskFilter(activeFilter);
    refreshItems(quickPick.value);
  });

  quickPick.onDidTriggerItemButton((event) => {
    quickPick.busy = true;
    quickPick.enabled = false;

    try {
      toggleTaskAtFileLine(event.item.task.filePath, event.item.task.fileLineIndex);
      refreshItems(quickPick.value);
    } finally {
      quickPick.busy = false;
      quickPick.enabled = true;
    }
  });

  quickPick.onDidHide(() => {
    void persistInboxTaskFilter(activeFilter);
    quickPick.dispose();
  });

  quickPick.show();
}
