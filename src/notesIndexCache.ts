import { collectNoteFiles } from "../shared/collectNoteFiles.js";
import { MAX_CACHE_ENTRIES } from "./constants.js";
import { buildIndexedNotes, type IndexedNote } from "./noteCommands.js";

interface CachedEntry {
  mtime: number;
  note: IndexedNote;
}
const cacheByKey = new Map<string, Map<string, CachedEntry>>();

function buildCacheKey(notesDir: string, excludeDirs: string[]): string {
  return `${notesDir}\u0000${excludeDirs.join(",")}`;
}

/**
 * Returns indexed notes for the given notes directory, reusing previously
 * parsed content for files whose mtime is unchanged. Avoids re-reading every
 * note on each sidebar refresh.
 */
export async function getIndexedNotesCached(
  notesDir: string,
  excludeDirs: string[] = [],
): Promise<IndexedNote[]> {
  const key = buildCacheKey(notesDir, excludeDirs);
  let cache = cacheByKey.get(key);
  if (!cache || cache.size > MAX_CACHE_ENTRIES) {
    cache = new Map<string, CachedEntry>();
    cacheByKey.set(key, cache);
  }

  const collected = await collectNoteFiles(notesDir, excludeDirs);
  const stalePaths = new Set(cache.keys());
  const notes: IndexedNote[] = [];
  const readTasks: Promise<IndexedNote>[] = [];

  const CONCURRENCY = 20;

  for (const file of collected) {
    stalePaths.delete(file.relativePath);
    const cached = cache.get(file.relativePath);
    if (cached && cached.mtime === file.mtime) {
      notes.push(cached.note);
      continue;
    }

    readTasks.push(
      (async () => {
        const [note] = await buildIndexedNotes([
          {
            relativePath: file.relativePath,
            absolutePath: file.filePath,
            mtime: file.mtime,
          },
        ]);
        cache!.set(file.relativePath, { mtime: file.mtime, note });
        return note;
      })(),
    );
  }

  for (const stalePath of stalePaths) {
    cache.delete(stalePath);
  }

  // Throttle concurrent reads to avoid EMFILE on large vaults
  const results: IndexedNote[] = [];
  for (let i = 0; i < readTasks.length; i += CONCURRENCY) {
    const batch = readTasks.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch)));
  }

  return notes.concat(results);
}
