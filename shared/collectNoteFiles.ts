import type { Dirent } from "fs";
import * as fs from "fs/promises";
import * as path from "path";

export interface CollectedNoteFile {
  filePath: string;
  relativePath: string;
  mtime: number;
}

// 並びは表示だけの話ではない。Backlinks パネルは collectBacklinks の Map をこの順で
// 描画し（wikiLinks.ts）、同名ノートは WikiLinkIndex が最初に見つけたものを採用する。
// 既定ロケール任せだと環境で結果が変わり、ICU が同順位とみなす名前（あ vs ア、9 vs ９）は
// 安定ソートの結果 readdir 順のまま残るため、固定ロケールで比べてコードポイントで決着させる。
const pathCollator = new Intl.Collator("ja");

function comparePaths(left: string, right: string): number {
  const byName = pathCollator.compare(left, right);
  if (byName !== 0) {
    return byName;
  }
  return left < right ? -1 : left > right ? 1 : 0;
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
  results.sort((left, right) => comparePaths(left.filePath, right.filePath));
  return results;
}
