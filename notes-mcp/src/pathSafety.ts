import * as path from "path";

export function isPathInside(parentDir: string, candidatePath: string): boolean {
  const resolvedParent = path.resolve(parentDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  );
}

export function resolveSafeFilePath(notesDir: string, relativePath: string): string | null {
  const resolved = path.resolve(notesDir, relativePath);
  if (!isPathInside(notesDir, resolved)) return null;
  return resolved;
}

export function sanitizeTitle(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}
