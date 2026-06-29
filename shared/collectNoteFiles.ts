import { Dirent } from "fs";
import * as fs from "fs/promises";
import * as path from "path";

export interface CollectedNoteFile {
  filePath: string;
  relativePath: string;
  mtime: number;
}

export async function collectNoteFiles(
  dir: string,
  excludeDirs: string[] = [],
): Promise<CollectedNoteFile[]> {
  const results: CollectedNoteFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.includes(entry.name)) {
          continue;
        }
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const stat = await fs.stat(full);
          results.push({
            filePath: full,
            relativePath: path.relative(dir, full),
            mtime: stat.mtimeMs,
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(dir);
  results.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return results;
}
