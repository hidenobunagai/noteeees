import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { collectNoteFiles } from "../../shared/collectNoteFiles.js";
import {
  hasFrontMatter,
  parseNoteBody,
  stripFrontMatter,
  stripFrontMatterTrimmed,
} from "../../shared/frontMatter.js";
import { stripDatePrefix, stripDatePrefixTitle } from "../../shared/noteFilename.js";
import {
  isPathInside,
  isValidSubfolderName,
  sanitizeSubfolderName,
} from "../../shared/pathSafety.js";
import { formatDateString, shiftDate, todayDateString } from "../dateUtils";
import { archiveMoments, ensureMomentsFile } from "../moments/fileIo";
import { getMomentsSubfolderSetting } from "../notesConfig";

async function withArchiveAfterDays<T>(days: number, run: () => T | Promise<T>): Promise<T> {
  const config = vscode.workspace.getConfiguration("notes");
  const original = config.get<number>("momentsArchiveAfterDays");
  await config.update("momentsArchiveAfterDays", days, vscode.ConfigurationTarget.Global);
  try {
    return await run();
  } finally {
    await config.update("momentsArchiveAfterDays", original, vscode.ConfigurationTarget.Global);
  }
}

async function withMomentsSubfolder<T>(value: string, run: () => T | Promise<T>): Promise<T> {
  const config = vscode.workspace.getConfiguration("notes");
  const original = config.get<string>("momentsSubfolder");
  await config.update("momentsSubfolder", value, vscode.ConfigurationTarget.Global);
  try {
    return await run();
  } finally {
    await config.update("momentsSubfolder", original, vscode.ConfigurationTarget.Global);
  }
}

suite("Shared Front Matter Test Suite", () => {
  test("parses LF front matter correctly", () => {
    const raw = "---\ntype: note\ntags: [a]\n---\n\n# Title\nbody\n";
    assert.strictEqual(hasFrontMatter(raw), true);
    assert.strictEqual(stripFrontMatter(raw), "\n# Title\nbody\n");

    const parsed = parseNoteBody(raw);
    assert.strictEqual(parsed.body, "\n# Title\nbody\n");
    // Front matter occupies lines 0-3, so body starts on line 4
    assert.strictEqual(parsed.bodyStartLine, 4);

    const rawThreeLines = "---\ntype: note\n---\n\n# Title\nbody\n";
    assert.strictEqual(parseNoteBody(rawThreeLines).bodyStartLine, 3);
  });

  test("parses CRLF front matter with normalized LF body and identical line count", () => {
    const rawCrlf = "---\r\ntype: note\r\ntags: [a]\r\n---\r\n\r\n# Title\r\nbody\r\n";
    assert.strictEqual(hasFrontMatter(rawCrlf), true);
    assert.strictEqual(stripFrontMatter(rawCrlf), "\n# Title\nbody\n");

    const parsed = parseNoteBody(rawCrlf);
    assert.strictEqual(parsed.body, "\n# Title\nbody\n");
    assert.strictEqual(parsed.bodyStartLine, 4);

    const rawCrlfThreeLines = "---\r\ntype: note\r\n---\r\n\r\n# Title\r\nbody\r\n";
    assert.strictEqual(parseNoteBody(rawCrlfThreeLines).bodyStartLine, 3);
  });

  test("handles BOM at the start of front matter", () => {
    const raw = "\uFEFF---\ntype: note\n---\n\nbody";
    assert.strictEqual(hasFrontMatter(raw), true);
    const body = stripFrontMatter(raw);
    assert.ok(body.startsWith("\nbody"));
    assert.strictEqual(body, "\nbody");
  });

  test("accepts delimiters with trailing whitespace", () => {
    const raw = "--- \ntype: note\n--- \nbody";
    assert.strictEqual(hasFrontMatter(raw), true);
    assert.strictEqual(stripFrontMatter(raw), "body");
  });

  test("does not treat unclosed front matter as front matter", () => {
    const raw = "---\ntype: note\nbody without closing delimiter";
    assert.strictEqual(hasFrontMatter(raw), false);
    assert.strictEqual(stripFrontMatter(raw), raw);
    assert.strictEqual(parseNoteBody(raw).bodyStartLine, 0);
  });

  test("handles content without front matter", () => {
    const raw = "# Title\nbody";
    assert.strictEqual(hasFrontMatter(raw), false);
    const parsed = parseNoteBody(raw);
    assert.strictEqual(parsed.bodyStartLine, 0);
    assert.strictEqual(parsed.body, raw);
    assert.strictEqual(stripFrontMatter(raw), raw);
  });

  test("stripFrontMatterTrimmed trims leading and trailing whitespace", () => {
    const raw = "---\ntype: note\n---\n\n  # Title\nbody  \n\n";
    assert.strictEqual(stripFrontMatterTrimmed(raw), "# Title\nbody");
  });

  test("does not treat later horizontal rules as front matter", () => {
    const raw = "intro\n---\nrest";
    assert.strictEqual(hasFrontMatter(raw), false);
    const parsed = parseNoteBody(raw);
    assert.strictEqual(parsed.bodyStartLine, 0);
    assert.strictEqual(parsed.body, raw);
  });

  test("parses combined CRLF, BOM, and trailing space delimiters", () => {
    const raw = "\uFEFF--- \r\ntype: note\r\n--- \r\n\r\nbody\r\n";
    assert.strictEqual(hasFrontMatter(raw), true);
    assert.strictEqual(stripFrontMatter(raw), "\nbody\n");
    assert.strictEqual(stripFrontMatterTrimmed(raw), "body");
  });
});

suite("Shared Path Safety Test Suite", () => {
  test("isPathInside validates containment correctly", () => {
    const parentDir = path.resolve(path.join(os.tmpdir(), "noteeees-test-parent"));

    // candidate inside parent -> true
    assert.strictEqual(isPathInside(parentDir, path.join(parentDir, "sub", "note.md")), true);

    // candidate === parent -> true
    assert.strictEqual(isPathInside(parentDir, parentDir), true);

    // sibling directory sharing a name prefix -> false
    assert.strictEqual(isPathInside(parentDir, path.resolve(`${parentDir}-evil`, "a.md")), false);

    // escape via ".." -> false
    assert.strictEqual(isPathInside(parentDir, path.join(parentDir, "..", "other", "a.md")), false);

    // unrelated absolute path -> false
    assert.strictEqual(
      isPathInside(parentDir, path.resolve(path.sep, "unrelated", "file.md")),
      false,
    );
  });

  test("isValidSubfolderName validates folder names correctly", () => {
    // Rejects empty and whitespace-only strings
    assert.strictEqual(isValidSubfolderName(""), false);
    assert.strictEqual(isValidSubfolderName("   "), false);

    // Rejects absolute paths
    assert.strictEqual(isValidSubfolderName(path.join(path.sep, "abs")), false);
    assert.strictEqual(isValidSubfolderName("/abs"), false);

    // Rejects dot and directory traversal escaping root
    assert.strictEqual(isValidSubfolderName(".."), false);
    assert.strictEqual(isValidSubfolderName("../x"), false);
    assert.strictEqual(isValidSubfolderName("."), false);
    assert.strictEqual(isValidSubfolderName("a/../../b"), false);

    // Accepts valid relative names
    assert.strictEqual(isValidSubfolderName("daily"), true);
    assert.strictEqual(isValidSubfolderName("a/b"), true);

    // a//b collapses to a/b via path.normalize, so it is valid
    assert.strictEqual(isValidSubfolderName("a//b"), true);
    assert.strictEqual(path.normalize("a//b"), path.join("a", "b"));

    // a/../b collapses to b via path.normalize, staying within root
    assert.strictEqual(isValidSubfolderName("a/../b"), true);
    assert.strictEqual(path.normalize("a/../b"), "b");

    // Windows separators and drive letters are rejected on every platform
    assert.strictEqual(isValidSubfolderName("a\\b"), false);
    assert.strictEqual(isValidSubfolderName("C:\\x"), false);
    assert.strictEqual(isValidSubfolderName("C:/x"), false);
    assert.strictEqual(isValidSubfolderName("\\abs"), false);

    // Japanese / Unicode subfolder names are valid
    assert.strictEqual(isValidSubfolderName("ノート"), true);
    assert.strictEqual(isValidSubfolderName("日々の記録"), true);
    assert.strictEqual(isValidSubfolderName("議事録/2026"), true);
  });

  test("sanitizeSubfolderName sanitizes valid values and applies fallback", () => {
    const fallback = "default";

    // Valid values return normalized paths
    assert.strictEqual(sanitizeSubfolderName("daily", fallback), "daily");
    assert.strictEqual(sanitizeSubfolderName("a//b", fallback), path.normalize("a//b"));
    assert.strictEqual(sanitizeSubfolderName("ノート", fallback), "ノート");

    // Invalid values return fallback
    assert.strictEqual(sanitizeSubfolderName("", fallback), fallback);
    assert.strictEqual(sanitizeSubfolderName("   ", fallback), fallback);
    assert.strictEqual(sanitizeSubfolderName("..", fallback), fallback);
    assert.strictEqual(sanitizeSubfolderName("../x", fallback), fallback);
    assert.strictEqual(sanitizeSubfolderName(path.join(path.sep, "abs"), fallback), fallback);
    assert.strictEqual(sanitizeSubfolderName("a\\b", fallback), fallback);
    assert.strictEqual(sanitizeSubfolderName("C:\\x", fallback), fallback);
    assert.strictEqual(sanitizeSubfolderName("C:/x", fallback), fallback);
  });

  test("getMomentsSubfolderSetting applies the same rules as pathSafety", async function () {
    // Each case writes the setting twice (set + restore), which is slower than 2s
    this.timeout(20000);
    const cases: Array<[string, string]> = [
      ["", "moments"],
      ["   ", "moments"],
      ["..", "moments"],
      ["../x", "moments"],
      ["a/../../b", "moments"],
      ["/abs", "moments"],
      ["a\\b", "moments"],
      ["C:\\x", "moments"],
      ["C:/x", "moments"],
      ["daily", "daily"],
      ["a/b", path.join("a", "b")],
      ["a//b", path.join("a", "b")],
      ["ノート", "ノート"],
      ["議事録/2026", path.join("議事録", "2026")],
    ];

    for (const [input, expected] of cases) {
      await withMomentsSubfolder(input, () => {
        const actual = getMomentsSubfolderSetting();
        assert.strictEqual(actual, expected, `input: ${JSON.stringify(input)}`);
        // Whatever survives the setting is a subfolder pathSafety calls valid
        assert.strictEqual(isValidSubfolderName(actual), true);
      });
    }
  });
});

suite("Shared Collect Note Files Test Suite", () => {
  test("default call returns markdown files sorted by filePath", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
    try {
      fs.writeFileSync(path.join(dir, "alpha.md"), "# Alpha");
      fs.writeFileSync(path.join(dir, "notes.txt"), "not markdown");
      fs.writeFileSync(path.join(dir, ".hidden.md"), "hidden note");
      fs.mkdirSync(path.join(dir, "sub", "deep"), { recursive: true });
      fs.writeFileSync(path.join(dir, "sub", "beta.md"), "# Beta");
      fs.writeFileSync(path.join(dir, "sub", "deep", "gamma.md"), "# Gamma");
      fs.mkdirSync(path.join(dir, ".hiddenDir"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".hiddenDir", "secret.md"), "# Secret");

      const results = await collectNoteFiles(dir);
      assert.strictEqual(results.length, 3);

      const expectedRelative = [
        "alpha.md",
        path.join("sub", "beta.md"),
        path.join("sub", "deep", "gamma.md"),
      ];
      assert.deepStrictEqual(
        results.map((r) => r.relativePath),
        expectedRelative,
      );

      // Verify sorted order (localeCompare on filePath)
      const sortedPaths = [...results.map((r) => r.filePath)].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(
        results.map((r) => r.filePath),
        sortedPaths,
      );

      // Verify fields
      for (const item of results) {
        assert.ok(path.isAbsolute(item.filePath), `${item.filePath} should be absolute`);
        assert.ok(item.mtime > 0, `${item.filePath} mtime should be positive`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("excludeDirs filters matching directory names at any depth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
    try {
      fs.writeFileSync(path.join(dir, "alpha.md"), "# Alpha");
      fs.mkdirSync(path.join(dir, "sub", "deep"), { recursive: true });
      fs.writeFileSync(path.join(dir, "sub", "beta.md"), "# Beta");
      fs.writeFileSync(path.join(dir, "sub", "deep", "gamma.md"), "# Gamma");

      fs.mkdirSync(path.join(dir, "excluded"), { recursive: true });
      fs.writeFileSync(path.join(dir, "excluded", "delta.md"), "# Delta");

      fs.mkdirSync(path.join(dir, "nested", "excluded"), { recursive: true });
      fs.writeFileSync(path.join(dir, "nested", "excluded", "epsilon.md"), "# Epsilon");

      // Without exclusion, all 5 markdown files are collected
      const allFiles = await collectNoteFiles(dir);
      assert.strictEqual(allFiles.length, 5);

      // With excludeDirs matching "excluded" at top level and nested
      const filtered = await collectNoteFiles(dir, ["excluded"]);
      assert.strictEqual(filtered.length, 3);
      assert.deepStrictEqual(
        filtered.map((r) => r.relativePath),
        ["alpha.md", path.join("sub", "beta.md"), path.join("sub", "deep", "gamma.md")],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips dot files and dot directories", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
    try {
      fs.writeFileSync(path.join(dir, ".hidden.md"), "# Hidden");
      fs.mkdirSync(path.join(dir, ".dotdir"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".dotdir", "secret.md"), "# Secret");
      fs.writeFileSync(path.join(dir, "visible.md"), "# Visible");

      const results = await collectNoteFiles(dir);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].relativePath, "visible.md");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips non-markdown files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
    try {
      fs.writeFileSync(path.join(dir, "notes.txt"), "text");
      fs.writeFileSync(path.join(dir, "image.png"), "binary");
      fs.writeFileSync(path.join(dir, "note.md"), "# Note");

      const results = await collectNoteFiles(dir);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].relativePath, "note.md");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns empty array for non-existent directory instead of throwing", async () => {
    const nonExistent = path.join(os.tmpdir(), `noteeees-shared-missing-${Date.now()}`);
    const results = await collectNoteFiles(nonExistent);
    assert.deepStrictEqual(results, []);
  });
});

suite("Shared Note Filename Test Suite", () => {
  test("stripDatePrefix extracts prefix with date and time", () => {
    assert.deepStrictEqual(stripDatePrefix("2026-02-11_15-40_Meeting notes"), {
      title: "Meeting notes",
      datePrefix: "2026-02-11_15-40",
    });
    assert.deepStrictEqual(stripDatePrefix("2026-02-11_15-40-30_With seconds"), {
      title: "With seconds",
      datePrefix: "2026-02-11_15-40-30",
    });
  });

  test("stripDatePrefix extracts prefix with date only", () => {
    assert.deepStrictEqual(stripDatePrefix("2026-02-11_Topic"), {
      title: "Topic",
      datePrefix: "2026-02-11",
    });
    assert.deepStrictEqual(stripDatePrefix("2026_02_11_Topic"), {
      title: "Topic",
      datePrefix: "2026_02_11",
    });
    assert.deepStrictEqual(stripDatePrefix("2026-02-11 Topic"), {
      title: "Topic",
      datePrefix: "2026-02-11",
    });
  });

  test("stripDatePrefix does not recognize time after space separator", () => {
    assert.deepStrictEqual(stripDatePrefix("2026-02-11 15-40_Note"), {
      title: "15-40_Note",
      datePrefix: "2026-02-11",
    });
  });

  test("stripDatePrefix leaves un-prefixed names unchanged", () => {
    assert.deepStrictEqual(stripDatePrefix("Meeting 2026-02-11"), {
      title: "Meeting 2026-02-11",
      datePrefix: "",
    });
    assert.deepStrictEqual(stripDatePrefix("2026-02-11"), {
      title: "2026-02-11",
      datePrefix: "",
    });
    assert.deepStrictEqual(stripDatePrefix("2026-02-11_"), {
      title: "2026-02-11_",
      datePrefix: "",
    });
    assert.deepStrictEqual(stripDatePrefix("2026-2-11_x"), {
      title: "2026-2-11_x",
      datePrefix: "",
    });
  });

  test("stripDatePrefixTitle returns only the title", () => {
    assert.strictEqual(stripDatePrefixTitle("2026-02-11_Meeting notes"), "Meeting notes");
    assert.strictEqual(stripDatePrefixTitle("Plain Note"), "Plain Note");
  });
});

suite("Moments File IO Test Suite", () => {
  test("ensureMomentsFile creates file with front matter and does not overwrite existing file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
    try {
      const date = "2026-03-01";
      const filePath = await ensureMomentsFile(tmpDir, date);
      assert.strictEqual(filePath, path.join(tmpDir, "moments", `${date}.md`));
      assert.ok(fs.existsSync(filePath));

      const initial = fs.readFileSync(filePath, "utf8");
      assert.strictEqual(initial, `---\ntype: moments\ndate: ${date}\n---\n\n`);

      // Append custom entry
      fs.appendFileSync(filePath, "- 10:00 Custom entry\n", "utf8");

      // Calling again must not overwrite the existing file
      const secondPath = await ensureMomentsFile(tmpDir, date);
      assert.strictEqual(secondPath, filePath);
      const afterSecond = fs.readFileSync(filePath, "utf8");
      assert.strictEqual(
        afterSecond,
        `---\ntype: moments\ndate: ${date}\n---\n\n- 10:00 Custom entry\n`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("archiveMoments moves old files, preserves recent and non-date files, and is idempotent", async () => {
    await withArchiveAfterDays(30, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
      try {
        const momentsDir = path.join(tmpDir, "moments");
        fs.mkdirSync(momentsDir, { recursive: true });

        const today = todayDateString();
        const oldDate = shiftDate(today, -100);
        const recentDate = shiftDate(today, -1);

        const oldFile = path.join(momentsDir, `${oldDate}.md`);
        fs.writeFileSync(
          oldFile,
          `---\ntype: moments\ndate: ${oldDate}\n---\n\n- 09:00 Old\n`,
          "utf8",
        );

        const recentFile = path.join(momentsDir, `${recentDate}.md`);
        fs.writeFileSync(
          recentFile,
          `---\ntype: moments\ndate: ${recentDate}\n---\n\n- 09:00 Recent\n`,
          "utf8",
        );

        const scratchFile = path.join(momentsDir, "scratch.md");
        fs.writeFileSync(scratchFile, "# Scratch\n", "utf8");

        const subDir = path.join(momentsDir, "notes-dir");
        fs.mkdirSync(subDir, { recursive: true });
        fs.writeFileSync(path.join(subDir, "nested.md"), "# Nested\n", "utf8");

        const result = await archiveMoments(tmpDir);
        assert.deepStrictEqual(result, { archived: 1, skipped: 1 });

        const yearMonth = oldDate.slice(0, 7);
        const archivedOldPath = path.join(momentsDir, "archive", yearMonth, `${oldDate}.md`);
        assert.ok(fs.existsSync(archivedOldPath), "Old file should exist in archive directory");
        assert.ok(!fs.existsSync(oldFile), "Old file should not exist in original path");

        assert.ok(fs.existsSync(recentFile), "Recent file should remain in moments directory");
        assert.ok(fs.existsSync(scratchFile), "scratch.md should remain untouched");
        assert.ok(
          fs.existsSync(path.join(subDir, "nested.md")),
          "Subdirectory contents should remain untouched",
        );

        // Idempotence: second run archives 0 and skips 1 (recent file)
        const secondResult = await archiveMoments(tmpDir);
        assert.deepStrictEqual(secondResult, { archived: 0, skipped: 1 });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  test("archiveMoments returns zero counts when moments directory is missing", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
    try {
      const result = await archiveMoments(tmpDir);
      assert.deepStrictEqual(result, { archived: 0, skipped: 0 });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("archiveMoments skips file whose date equals the cutoff boundary", async () => {
    await withArchiveAfterDays(30, async () => {
      const cutoffDateBefore = new Date();
      cutoffDateBefore.setDate(cutoffDateBefore.getDate() - 30);
      const cutoffBefore = formatDateString(cutoffDateBefore);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-shared-"));
      try {
        const momentsDir = path.join(tmpDir, "moments");
        fs.mkdirSync(momentsDir, { recursive: true });

        const cutoffFile = path.join(momentsDir, `${cutoffBefore}.md`);
        fs.writeFileSync(
          cutoffFile,
          `---\ntype: moments\ndate: ${cutoffBefore}\n---\n\n- 09:00 Cutoff\n`,
          "utf8",
        );

        const result = await archiveMoments(tmpDir);

        const cutoffDateAfter = new Date();
        cutoffDateAfter.setDate(cutoffDateAfter.getDate() - 30);
        const cutoffAfter = formatDateString(cutoffDateAfter);

        // Guard against midnight rollover during test execution
        if (cutoffBefore !== cutoffAfter) {
          return;
        }

        assert.deepStrictEqual(result, { archived: 0, skipped: 1 });
        assert.ok(fs.existsSync(cutoffFile), "File on cutoff boundary should not be archived");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
