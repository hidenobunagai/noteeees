import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { parseWikiLinks, resolveWikiLinkPath, collectBacklinks } from "../wikiLinks.js";

suite("WikiLinks - parseWikiLinks", () => {
  test("extracts single wiki link", () => {
    const result = parseWikiLinks("See [[Meeting Notes]] for details.");
    assert.deepStrictEqual(result, ["Meeting Notes"]);
  });

  test("extracts multiple wiki links", () => {
    const result = parseWikiLinks("[[A]] and [[B]] and [[C]]");
    assert.deepStrictEqual(result, ["A", "B", "C"]);
  });

  test("returns empty array for no links", () => {
    const result = parseWikiLinks("No links here");
    assert.deepStrictEqual(result, []);
  });

  test("handles empty string", () => {
    const result = parseWikiLinks("");
    assert.deepStrictEqual(result, []);
  });

  test("handles Japanese link text", () => {
    const result = parseWikiLinks("[[会議メモ]]を参照");
    assert.deepStrictEqual(result, ["会議メモ"]);
  });

  test("handles link with spaces", () => {
    const result = parseWikiLinks("[[Project Alpha]]");
    assert.deepStrictEqual(result, ["Project Alpha"]);
  });
});

suite("WikiLinks - resolveWikiLinkPath", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-test-"));
    fs.writeFileSync(path.join(tmpDir, "Meeting Notes.md"), "# Meeting Notes", "utf8");
    fs.writeFileSync(path.join(tmpDir, "2025-01-15_Daily.md"), "# Daily", "utf8");
    const subDir = path.join(tmpDir, "projects");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "Alpha.md"), "# Alpha", "utf8");
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolves by exact filename match", () => {
    const result = resolveWikiLinkPath("Meeting Notes", tmpDir);
    assert.ok(result);
    assert.strictEqual(path.basename(result), "Meeting Notes.md");
  });

  test("resolves by case-insensitive match", () => {
    const result = resolveWikiLinkPath("meeting notes", tmpDir);
    assert.ok(result);
    assert.strictEqual(path.basename(result), "Meeting Notes.md");
  });

  test("resolves by suffix match after date prefix", () => {
    const result = resolveWikiLinkPath("Daily", tmpDir);
    assert.ok(result);
    assert.strictEqual(path.basename(result), "2025-01-15_Daily.md");
  });

  test("resolves in subdirectory", () => {
    const result = resolveWikiLinkPath("Alpha", tmpDir);
    assert.ok(result);
    assert.strictEqual(result.endsWith(path.join("projects", "Alpha.md")), true);
  });

  test("returns undefined for non-existent note", () => {
    const result = resolveWikiLinkPath("NonExistent", tmpDir);
    assert.strictEqual(result, undefined);
  });
});

suite("WikiLinks - collectBacklinks", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-backlinks-"));
    fs.writeFileSync(path.join(tmpDir, "Target.md"), "# Target Note\nContent here.", "utf8");
    fs.writeFileSync(
      path.join(tmpDir, "Source1.md"),
      "# Source 1\nSome text [[Target]] here.",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "Source2.md"),
      "# Source 2\n- Ref: [[Target]]\n- Other: [[Unknown]]",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "NoLinks.md"),
      "# No Links\nJust regular text.",
      "utf8",
    );
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("finds backlinks from multiple source files", () => {
    const targetFile = path.join(tmpDir, "Target.md");
    const result = collectBacklinks(targetFile, tmpDir);
    assert.strictEqual(result.size, 2);
  });

  test("includes correct line numbers", () => {
    const targetFile = path.join(tmpDir, "Target.md");
    const result = collectBacklinks(targetFile, tmpDir);
    const source1Items = result.get(path.join(tmpDir, "Source1.md"));
    assert.ok(source1Items);
    assert.strictEqual(source1Items[0].lineNumber, 1);
  });

  test("skips self-referencing links", () => {
    const targetFile = path.join(tmpDir, "Target.md");
    const result = collectBacklinks(targetFile, tmpDir);
    assert.ok(!result.has(targetFile));
  });

  test("returns empty map for file with no backlinks", () => {
    const noLinksFile = path.join(tmpDir, "NoLinks.md");
    const result = collectBacklinks(noLinksFile, tmpDir);
    assert.strictEqual(result.size, 0);
  });
});
