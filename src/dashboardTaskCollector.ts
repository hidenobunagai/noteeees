import * as fs from "fs";
import * as path from "path";
import type { DashTask } from "./dashboardTypes.js";
import { TASK_RE, TAG_RE, DUE_DATE_RE, dateFromFilePath } from "./dashboardTaskUtils.js";

export function collectTasksFromNotes(notesDir: string, momentsSubfolder = "moments"): DashTask[] {
  const tasks: DashTask[] = [];
  const momentsAbsPath = path.resolve(notesDir, momentsSubfolder);

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) === momentsAbsPath) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const date = dateFromFilePath(fullPath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      const relPath = path.relative(notesDir, fullPath);
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
          filePath: fullPath,
          lineIndex: i,
          text,
          done: match[1].toLowerCase() === "x",
          date,
          dueDate: dueDateMatch ? dueDateMatch[1] : null,
          tags,
        });
      }
    }
  }

  walk(notesDir);
  return tasks;
}
