import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isPathInside, resolveSafeFilePath, sanitizeTitle } from "../src/pathSafety.js";

describe("isPathInside", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "path-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("allows path inside directory", () => {
    const child = path.join(tmpDir, "notes", "test.md");
    expect(isPathInside(tmpDir, child)).toBe(true);
  });

  test("allows exact directory match", () => {
    expect(isPathInside(tmpDir, tmpDir)).toBe(true);
  });

  test("blocks parent directory traversal", () => {
    const parent = path.resolve(tmpDir, "..");
    expect(isPathInside(tmpDir, parent)).toBe(false);
  });

  test("blocks deep traversal with ../", () => {
    const escape = path.join(tmpDir, "..", "..", "etc", "passwd");
    expect(isPathInside(tmpDir, escape)).toBe(false);
  });

  test("blocks sibling directory", () => {
    const sibling = path.resolve(tmpDir, "../other-dir");
    expect(isPathInside(tmpDir, sibling)).toBe(false);
  });
});

describe("resolveSafeFilePath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-path-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolves safe relative path", () => {
    const result = resolveSafeFilePath(tmpDir, "notes/test.md");
    expect(result).toBe(path.resolve(tmpDir, "notes/test.md"));
  });

  test("rejects path traversal", () => {
    const result = resolveSafeFilePath(tmpDir, "../../etc/passwd");
    expect(result).toBeNull();
  });

  test("rejects absolute path outside notes", () => {
    const result = resolveSafeFilePath(tmpDir, "/etc/passwd");
    expect(result).toBeNull();
  });

  test("allows nested subdirectory", () => {
    const result = resolveSafeFilePath(tmpDir, "projects/deep/note.md");
    expect(result).toBe(path.resolve(tmpDir, "projects/deep/note.md"));
  });
});

describe("sanitizeTitle", () => {
  test("replaces invalid filename characters", () => {
    expect(sanitizeTitle("hello/world:test")).toBe("hello_world_test");
  });

  test("replaces whitespace with underscores", () => {
    expect(sanitizeTitle("my note title")).toBe("my_note_title");
  });

  test("truncates to 80 characters", () => {
    const long = "a".repeat(200);
    expect(sanitizeTitle(long).length).toBe(80);
  });

  test("handles backslashes and special chars", () => {
    expect(sanitizeTitle("file\\name*here?yes|no")).toBe("file_name_here_yes_no");
  });

  test("handles empty string", () => {
    expect(sanitizeTitle("")).toBe("");
  });
});
