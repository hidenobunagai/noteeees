import * as vscode from "vscode";
import * as fs from "fs";

interface ReminderEntry {
  dateTime: string;
  content: string;
  reminderDate: string;
  line: number;
}

export function extractReminders(memoryPath: string): ReminderEntry[] {
  if (!fs.existsSync(memoryPath)) {
    return [];
  }

  const content = fs.readFileSync(memoryPath, "utf8");
  const lines = content.split("\n");
  const reminders: ReminderEntry[] = [];

  let currentDateTime = "";
  let currentContent = "";
  let currentLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const headerMatch = line.match(/^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)(.*)$/);

    if (headerMatch) {
      // Check previous entry for reminder
      if (currentContent) {
        const reminderMatch = currentContent.match(/@(\d{4}-\d{2}-\d{2})/);
        if (reminderMatch) {
          reminders.push({
            dateTime: currentDateTime,
            content: currentContent.replace(/@\d{4}-\d{2}-\d{2}\s*/g, "").trim(),
            reminderDate: reminderMatch[1],
            line: currentLine,
          });
        }
      }

      currentDateTime = headerMatch[1];
      currentContent = headerMatch[2];
      currentLine = i;
    } else if (line.trim() && !line.startsWith("# ")) {
      currentContent += "\n" + line;
    }
  }

  // Check last entry
  if (currentContent) {
    const reminderMatch = currentContent.match(/@(\d{4}-\d{2}-\d{2})/);
    if (reminderMatch) {
      reminders.push({
        dateTime: currentDateTime,
        content: currentContent.replace(/@\d{4}-\d{2}-\d{2}\s*/g, "").trim(),
        reminderDate: reminderMatch[1],
        line: currentLine,
      });
    }
  }

  // Sort by reminder date
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
      description: r.content.substring(0, 60).replace(/\n/g, " "),
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
