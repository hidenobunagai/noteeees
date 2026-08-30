import * as fs from "fs/promises";
import * as path from "path";

export function isPathInside(parentDir: string, candidatePath: string): boolean {
  const resolvedParent = path.resolve(parentDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  );
}

export function isValidSubfolderName(value: string): boolean {
  if (!value || value.trim().length === 0) {
    return false;
  }
  if (path.isAbsolute(value)) {
    return false;
  }
  const normalized = path.normalize(value);
  if (normalized === "." || normalized.startsWith(`..${path.sep}`) || normalized === "..") {
    return false;
  }
  const segments = normalized.split(path.sep);
  if (segments.some((seg) => seg === ".." || seg === "." || seg.length === 0)) {
    return false;
  }
  return true;
}

export function sanitizeSubfolderName(value: string, fallback: string): string {
  if (isValidSubfolderName(value)) {
    return path.normalize(value);
  }
  return fallback;
}

export async function resolveUniqueFilePath(
  targetDir: string,
  filename: string,
): Promise<string> {
  const candidate = path.join(targetDir, filename);
  try {
    await fs.access(candidate);
  } catch {
    return candidate;
  }

  const extIndex = filename.lastIndexOf(".");
  const stem = extIndex > 0 ? filename.slice(0, extIndex) : filename;
  const ext = extIndex > 0 ? filename.slice(extIndex) : "";

  for (let i = 2; i <= 99; i++) {
    const uniquePath = path.join(targetDir, `${stem}-${i}${ext}`);
    try {
      await fs.access(uniquePath);
    } catch {
      return uniquePath;
    }
  }

  return candidate;
}
