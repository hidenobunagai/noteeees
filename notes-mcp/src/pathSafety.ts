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

// ---------------------------------------------------------------------------
// Input size limits — prevents DoS via huge payloads
// ---------------------------------------------------------------------------

export const MAX_CONTENT_SIZE = 1_048_576; // 1 MiB

export function enforceMaxContentSize(
  value: unknown,
  maxBytes = MAX_CONTENT_SIZE,
): { valid: true; value: string } | { valid: false; error: string } {
  if (typeof value !== "string") {
    return { valid: false, error: "content must be a string" };
  }

  const byteSize = Buffer.byteLength(value, "utf8");
  if (byteSize > maxBytes) {
    return {
      valid: false,
      error: `content exceeds maximum size of ${Math.round(maxBytes / 1024)} KiB`,
    };
  }

  return { valid: true, value };
}
