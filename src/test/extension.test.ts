import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractTasksFromTextWithStatus } from "../aiTaskProcessor";
import {
  buildTagSearchItems,
  createNotesWatcherPattern,
  resolveNotesDirectory,
} from "../extension";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import {
  buildNoteSearchDetail,
  buildQueryExcerpt,
  extractNoteMetadata,
  extractPreviewText,
  formatDateYMD,
  resolveUniqueFilePath,
  shouldPromptForTemplateSelection,
} from "../noteCommands";
import {
  buildSidebarTagGroups,
  buildTagNoteDescription,
  buildTagSummary,
  limitSidebarNotes,
  movePinnedItem,
} from "../sidebarProvider";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("template picker is skipped without custom templates", () => {
    assert.strictEqual(shouldPromptForTemplateSelection([]), false);
  });

  test("template picker is shown with custom templates", () => {
    assert.strictEqual(shouldPromptForTemplateSelection(["meeting"]), true);
  });

  test("notes directory prefers local storage over synced settings", () => {
    assert.strictEqual(
      resolveNotesDirectory("/local/notes", "/synced/notes", undefined),
      "/local/notes",
    );
    assert.strictEqual(
      resolveNotesDirectory(undefined, "/synced/notes", undefined),
      "/synced/notes",
    );
    assert.strictEqual(resolveNotesDirectory(undefined, undefined, undefined), undefined);
  });

  test("notes directory workspace setting overrides global storage", () => {
    assert.strictEqual(
      resolveNotesDirectory("/global/notes", undefined, "/workspace/notes"),
      "/workspace/notes",
    );
    assert.strictEqual(
      resolveNotesDirectory("/global/notes", "/synced/notes", "/workspace/notes"),
      "/workspace/notes",
    );
    assert.strictEqual(
      resolveNotesDirectory(undefined, undefined, "/workspace/notes"),
      "/workspace/notes",
    );
  });

  test("note metadata prefers heading title and merges tags", () => {
    const metadata = extractNoteMetadata(
      "---\ntags: [project]\n---\n\n# Weekly Sync\nDiscuss #todo items",
      "fallback-title",
    );

    assert.strictEqual(metadata.title, "Weekly Sync");
    assert.deepStrictEqual(metadata.tags, ["#project", "#todo"]);
  });

  test("preview text strips front matter and collapses newlines", () => {
    const preview = extractPreviewText(
      "---\ntags: [project]\n---\n\n# Weekly Sync\n\nDiscuss roadmap\nNext actions",
      80,
    );

    assert.strictEqual(preview, "# Weekly Sync Discuss roadmap Next actions");
  });

  test("query excerpt centers around the first match", () => {
    const excerpt = buildQueryExcerpt(
      "alpha beta gamma delta roadmap epsilon zeta eta theta iota kappa",
      "roadmap",
      30,
    );

    assert.ok(excerpt.startsWith("…"));
    assert.ok(excerpt.endsWith("…"));
    assert.ok(excerpt.includes("roadmap"));
    assert.ok(!excerpt.includes("amma delta"));
  });

  test("note search detail includes query-matched excerpt", () => {
    const detail = buildNoteSearchDetail(
      {
        relativePath: "projects/weekly-sync.md",
        absolutePath: "/tmp/projects/weekly-sync.md",
        mtime: new Date("2026-03-07T10:00:00Z").getTime(),
        metadata: { title: "Weekly Sync", tags: ["#project"] },
        preview: "General planning note",
        searchText: "General planning note with roadmap milestones and follow ups",
      },
      "roadmap",
    );

    assert.ok(detail.includes("#project"));
    assert.ok(detail.includes("roadmap milestones"));
  });

  test("note metadata extracts Japanese inline hashtags", () => {
    const metadata = extractNoteMetadata(
      "# 週次レビュー\n日本語タグ #振り返り－設計 と #設計 を確認",
      "fallback-title",
    );

    assert.deepStrictEqual(metadata.tags, ["#振り返り-設計", "#設計"]);
  });

  test("tag summary is sorted by frequency", () => {
    const summary = buildTagSummary([
      { tags: ["#project", "#todo"] },
      { tags: ["#todo"] },
      { tags: ["#review"] },
    ]);

    assert.deepStrictEqual(summary, [
      { tag: "#todo", count: 2 },
      { tag: "#project", count: 1 },
      { tag: "#review", count: 1 },
    ]);
  });

  test("tag summary can be sorted alphabetically", () => {
    const summary = buildTagSummary(
      [{ tags: ["#zeta", "#beta"] }, { tags: ["#alpha"] }],
      "alphabetical",
    );

    assert.deepStrictEqual(summary, [
      { tag: "#alpha", count: 1 },
      { tag: "#beta", count: 1 },
      { tag: "#zeta", count: 1 },
    ]);
  });

  test("sidebar tag groups include latest note context", () => {
    const groups = buildSidebarTagGroups(
      [
        {
          tags: ["#project"],
          title: "Beta",
          relativePath: "projects/beta.md",
          mtime: new Date("2026-03-06T10:00:00Z").getTime(),
        },
        {
          tags: ["#project", "#todo"],
          title: "Alpha",
          relativePath: "projects/alpha.md",
          mtime: new Date("2026-03-07T10:00:00Z").getTime(),
        },
      ],
      "frequency",
    );

    assert.deepStrictEqual(groups[0], {
      tag: "#project",
      count: 2,
      latestTitle: "Alpha",
      latestRelativePath: "projects/alpha.md",
      latestMtime: new Date("2026-03-07T10:00:00Z").getTime(),
    });
  });

  test("tag note description includes path and tag-aware excerpt", () => {
    const description = buildTagNoteDescription(
      {
        relativePath: "projects/alpha.md",
        mtime: new Date("2026-03-07T10:00:00Z").getTime(),
        preview: "Roadmap review for #project launch next week",
        searchText: "Roadmap review for #project launch next week",
      },
      "#project",
    );

    assert.ok(description.includes("projects/alpha.md"));
    assert.ok(description.includes("#project launch"));
  });

  test("recent notes limit keeps newest items only", () => {
    assert.deepStrictEqual(limitSidebarNotes([1, 2, 3], 2), [1, 2]);
    assert.deepStrictEqual(limitSidebarNotes([1, 2, 3], 0), [1, 2, 3]);
  });

  test("pinned items can move up and down", () => {
    assert.deepStrictEqual(movePinnedItem(["a", "b", "c"], 1, "up"), ["b", "a", "c"]);
    assert.deepStrictEqual(movePinnedItem(["a", "b", "c"], 1, "down"), ["a", "c", "b"]);
    assert.deepStrictEqual(movePinnedItem(["a", "b", "c"], 0, "up"), ["a", "b", "c"]);
  });

  test("notes watcher pattern is scoped to notes directory", () => {
    const notesDir = path.join("/tmp", "notes");
    const pattern = createNotesWatcherPattern(notesDir);

    assert.ok(pattern instanceof vscode.RelativePattern);
    assert.strictEqual(pattern.baseUri.fsPath, notesDir);
    assert.strictEqual(pattern.pattern, "**/*.md");
    assert.strictEqual(createNotesWatcherPattern(undefined), undefined);
  });

  test("extractTasksFromTextWithStatus reports when no Copilot chat model is available", async () => {
    const lmApi = vscode.lm as typeof vscode.lm & {
      selectChatModels: typeof vscode.lm.selectChatModels;
    };
    const originalSelectChatModels = lmApi.selectChatModels;

    lmApi.selectChatModels = async () => [];

    try {
      const result = await extractTasksFromTextWithStatus(
        "- 09:00 明日の請求書を送る",
        new vscode.CancellationTokenSource().token,
      );

      assert.deepStrictEqual(result, {
        tasks: [],
        failureReason: "modelUnavailable",
      });
    } finally {
      lmApi.selectChatModels = originalSelectChatModels;
    }
  });

  test("extractTasksFromTextWithStatus accepts JSON wrapped in explanatory text", async () => {
    const lmApi = vscode.lm as typeof vscode.lm & {
      selectChatModels: typeof vscode.lm.selectChatModels;
    };
    const originalSelectChatModels = lmApi.selectChatModels;
    const chunks = [
      "以下が抽出結果です。\n\n```json\n",
      '[{"text":"請求書を送る","category":"work","priority":"high","timeEstimateMin":15,"dueDate":null}]',
      "\n```",
    ];

    lmApi.selectChatModels = async () => [
      {
        id: "copilot-test",
        name: "Copilot Test",
        vendor: "copilot",
        family: "gpt-test",
        async sendRequest() {
          return {
            text: (async function* () {
              for (const chunk of chunks) {
                yield chunk;
              }
            })(),
          };
        },
      } as unknown as vscode.LanguageModelChat,
    ];

    try {
      const result = await extractTasksFromTextWithStatus(
        "- 09:00 明日の請求書を送る",
        new vscode.CancellationTokenSource().token,
      );

      assert.deepStrictEqual(result, {
        tasks: [
          {
            text: "請求書を送る",
            category: "work",
            priority: "high",
            timeEstimateMin: 15,
            dueDate: null,
          },
        ],
        failureReason: null,
      });
    } finally {
      lmApi.selectChatModels = originalSelectChatModels;
    }
  });

  test("formatDateYMD zero-pads month and day", () => {
    assert.strictEqual(formatDateYMD(new Date(2024, 0, 5)), "2024-01-05");
    assert.strictEqual(formatDateYMD(new Date(2025, 11, 31)), "2025-12-31");
    assert.strictEqual(formatDateYMD(new Date(2000, 0, 1)), "2000-01-01");
  });

  test("resolveUniqueFilePath returns original path when no collision", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-test-"));
    try {
      const result = await resolveUniqueFilePath(tmpDir, "note.md");
      assert.strictEqual(result, path.join(tmpDir, "note.md"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("resolveUniqueFilePath appends -2 suffix on single collision", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "note.md"), "");
      const result = await resolveUniqueFilePath(tmpDir, "note.md");
      assert.strictEqual(result, path.join(tmpDir, "note-2.md"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("resolveUniqueFilePath increments counter past all existing suffixes", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "note.md"), "");
      fs.writeFileSync(path.join(tmpDir, "note-2.md"), "");
      const result = await resolveUniqueFilePath(tmpDir, "note.md");
      assert.strictEqual(result, path.join(tmpDir, "note-3.md"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("buildQueryExcerpt returns empty string for empty input", () => {
    assert.strictEqual(buildQueryExcerpt("", "query", 100), "");
  });

  test("buildQueryExcerpt returns full text when query term is not found and text fits", () => {
    assert.strictEqual(buildQueryExcerpt("short text", "notfound", 100), "short text");
  });

  test("buildQueryExcerpt truncates long text when query term is not found", () => {
    const long = "a".repeat(110);
    const result = buildQueryExcerpt(long, "notfound", 100);
    assert.ok(result.endsWith("…"));
    assert.ok(result.length <= 100);
  });

  test("tag search items include latest note context", () => {
    const items = buildTagSearchItems(
      [
        {
          relativePath: "projects/alpha.md",
          absolutePath: "/tmp/projects/alpha.md",
          mtime: new Date("2026-03-07T10:00:00Z").getTime(),
          metadata: { title: "Alpha", tags: ["#project"] },
          preview: "Alpha preview",
          searchText: "Alpha preview",
        },
        {
          relativePath: "projects/beta.md",
          absolutePath: "/tmp/projects/beta.md",
          mtime: new Date("2026-03-06T10:00:00Z").getTime(),
          metadata: { title: "Beta", tags: ["#project", "#todo"] },
          preview: "Beta preview",
          searchText: "Beta preview",
        },
      ],
      "frequency",
    );

    assert.strictEqual(items[0].label, "#project");
    assert.strictEqual(items[0].description, "2 notes");
    assert.ok(items[0].detail?.includes("Latest: Alpha"));
    assert.ok(items[0].detail?.includes("projects/alpha.md"));
  });
});
