import * as fs from "fs/promises";
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

function normalizeMomentTextForSearch(text: string): string {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sortOpenTaskOverview<T extends { date: string; time: string; done?: boolean }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => compareOpenTaskOverview(a, b));
}

export function buildTaskSearchDetail(item: TaskOverviewItem, query: string = ""): string {
  const details = [`${item.relativePath}:${item.fileLineIndex + 1}`];
  const normalizedQuery = query.trim();
  const searchText = normalizeMomentTextForSearch(item.text);

  if (normalizedQuery) {
    const excerpt = buildQueryExcerpt(
      `${item.relativePath} ${item.date} ${item.time} ${item.done ? "done" : "open"} ${searchText}`,
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
    label: `$(checklist) ${normalizeMomentTextForSearch(item.text)}`,
    description: `${item.date} • ${item.time} • ${item.done ? "Done" : "Open"}`,
    detail: buildTaskSearchDetail(item, query),
    buttons: [
      {
        iconPath: new vscode.ThemeIcon(item.done ? "circle-large-outline" : "check"),
        tooltip: item.done ? "Mark as open" : "Mark as done",
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

  return "All Moments";
}

function buildInboxFilterButton(filter: InboxTaskFilter): vscode.QuickInputButton {
  return {
    iconPath: new vscode.ThemeIcon("filter"),
    tooltip: `Switch inbox filter (${getInboxFilterLabel(filter)})`,
  };
}

async function collectOpenTaskOverview(notesDir: string): Promise<TaskOverviewItem[]> {
  const momentsDir = getMomentsDirectory(notesDir);
  try {
    await fs.access(momentsDir);
  } catch {
    return [];
  }

  const files = await fs.readdir(momentsDir, { withFileTypes: true });
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
    const raw = await fs.readFile(filePath, "utf8");
    const entries = await readMoments(notesDir, date);

    for (const entry of entries) {
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

async function toggleTaskAtFileLine(filePath: string, fileLineIndex: number): Promise<boolean> {
  try {
    await fs.access(filePath);
  } catch {
    return false;
  }

  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split("\n");
  if (fileLineIndex < 0 || fileLineIndex >= lines.length) {
    return false;
  }

  const result = toggleMomentTaskLine(lines[fileLineIndex]);
  if (!result.changed) {
    return false;
  }

  lines[fileLineIndex] = result.line;
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return true;
}

export async function showOpenTasksOverview(notesDir: string): Promise<void> {
  const quickPick = vscode.window.createQuickPick<OpenTaskQuickPickItem>();
  let activeFilter: InboxTaskFilter = getConfiguredInboxTaskFilter();
  setLastInboxTaskFilter(activeFilter);
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.buttons = [buildInboxFilterButton(activeFilter)];

  const refreshItems = async (query: string = quickPick.value): Promise<number> => {
    const items = await collectOpenTaskOverview(notesDir);
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

  if ((await refreshItems()) === 0) {
    quickPick.dispose();
    vscode.window.showInformationMessage("No moments found across all days.");
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
    void refreshItems(value);
  });

  quickPick.onDidTriggerButton(() => {
    activeFilter = getNextInboxFilter(activeFilter);
    void persistInboxTaskFilter(activeFilter);
    void refreshItems(quickPick.value);
  });

  quickPick.onDidTriggerItemButton(async (event) => {
    quickPick.busy = true;
    quickPick.enabled = false;

    try {
      await toggleTaskAtFileLine(event.item.task.filePath, event.item.task.fileLineIndex);
      await refreshItems(quickPick.value);
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
