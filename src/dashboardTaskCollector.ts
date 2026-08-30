import * as fs from "fs/promises";
import { collectNoteFiles } from "../shared/collectNoteFiles.js";
import { DUE_DATE_RE, TAG_RE, TASK_RE } from "../shared/taskSyntax.js";
import { dateFromFilePath } from "./dashboardTaskUtils.js";
import type { DashTask } from "./dashboardTypes.js";

export async function collectTasksFromNotes(
  notesDir: string,
  momentsSubfolder = "moments",
): Promise<DashTask[]> {
  const tasks: DashTask[] = [];
  const collected = await collectNoteFiles(notesDir, [momentsSubfolder]);

  for (const file of collected) {
    const date = dateFromFilePath(file.filePath);
    let content: string;
    try {
      content = await fs.readFile(file.filePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    const relPath = file.relativePath;
    for (let i = 0; i < lines.length; i++) {
      const match = TASK_RE.exec(lines[i]);
      if (!match) {
        continue;
      }

      const text = match[2].trim();
      const tags = [...new Set(text.match(TAG_RE) ?? [])];
      const dueDateMatch = DUE_DATE_RE.exec(text);
      tasks.push({
        id: `${relPath}:${i}`,
        filePath: file.filePath,
        lineIndex: i,
        text,
        done: match[1].toLowerCase() === "x",
        date,
        dueDate: dueDateMatch ? dueDateMatch[1] : null,
        tags,
      });
    }
  }

  return tasks;
}
