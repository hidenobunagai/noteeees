import * as vscode from "vscode";
import { getMemoryEntryPreview, parseMemoryFile } from "./memoryEntries";

interface ReminderEntry {
  dateTime: string;
  content: string;
  reminderDate: string;
  line: number;
}

export function extractReminders(memoryPath: string): ReminderEntry[] {
  const reminders = parseMemoryFile(memoryPath).flatMap((entry) => {
    const reminderMatch = entry.content.match(/@(\d{4}-\d{2}-\d{2})/);
    if (!reminderMatch) {
      return [];
    }

    return [
      {
        dateTime: entry.dateTime,
        content: entry.content.replace(/@\d{4}-\d{2}-\d{2}\s*/g, "").trim(),
        reminderDate: reminderMatch[1],
        line: entry.line,
      },
    ];
  });

  return reminders.sort((a, b) => a.reminderDate.localeCompare(b.reminderDate));
}

export async function showReminders(memoryPath: string): Promise<void> {
  const reminders = extractReminders(memoryPath);

  if (reminders.length === 0) {
    vscode.window.showInformationMessage("No reminders found. Use @YYYY-MM-DD to set a reminder.");
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  const items: vscode.QuickPickItem[] = reminders.map((r) => {
    const isPast = r.reminderDate < today;
    const isToday = r.reminderDate === today;
    const icon = isPast ? "$(warning)" : isToday ? "$(bell)" : "$(calendar)";
    const status = isPast ? "(OVERDUE)" : isToday ? "(TODAY)" : "";

    return {
      label: `${icon} ${r.reminderDate} ${status}`,
      description: getMemoryEntryPreview(r.content, 60),
      detail: `Created: ${r.dateTime} | Line ${r.line + 1}`,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `${reminders.length} reminder(s) found`,
  });

  if (selected) {
    const lineNum = parseInt(selected.detail?.match(/Line (\d+)/)?.[1] || "1") - 1;
    const doc = await vscode.workspace.openTextDocument(memoryPath);
    const editor = await vscode.window.showTextDocument(doc);
    const position = new vscode.Position(lineNum, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}
