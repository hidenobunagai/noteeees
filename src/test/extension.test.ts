import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildTagSearchItems,
  createNotesWatcherPattern,
  resolveNotesDirectory,
} from "../extension";
import {
  buildMomentsDateLabel,
  buildMomentsFeedDates,
  buildTaskSearchDetail,
  deleteMomentLine,
  extractMomentTags,
  filterMomentEntries,
  filterTaskOverviewItems,
  getDueDateStatus,
  getNextInboxFilter,
  mapMomentBodyIndexToFileLine,
  normalizeMomentLineToUnchecked,
  normalizeInboxTaskFilter,
  normalizeMomentsFeedDayCount,
  parseDueDate,
  resolvePinnedEntries,
  replaceMomentEntryText,
  sortOpenTaskOverview,
  toggleMomentTaskLine,
} from "../momentsPanel";
import {
  appendMoment,
  collectMomentsFeed,
  deleteMomentEntry,
  getMomentsFilePath,
  formatDate,
  readMoments,
  saveMomentEdit,
} from "../moments/fileIo";

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
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("template picker is skipped without custom templates", () => {
    assert.strictEqual(shouldPromptForTemplateSelection([]), false);
  });

  test("template picker is shown with custom templates", () => {
    assert.strictEqual(shouldPromptForTemplateSelection(["meeting"]), true);
  });

  test("notes directory prefers local storage over synced settings", () => {
    assert.strictEqual(resolveNotesDirectory("/local/notes", "/synced/notes", undefined), "/local/notes");
    assert.strictEqual(resolveNotesDirectory(undefined, "/synced/notes", undefined), "/synced/notes");
    assert.strictEqual(resolveNotesDirectory(undefined, undefined, undefined), undefined);
  });

  test("notes directory workspace setting overrides global storage", () => {
    assert.strictEqual(resolveNotesDirectory("/global/notes", undefined, "/workspace/notes"), "/workspace/notes");
    assert.strictEqual(resolveNotesDirectory("/global/notes", "/synced/notes", "/workspace/notes"), "/workspace/notes");
    assert.strictEqual(resolveNotesDirectory(undefined, undefined, "/workspace/notes"), "/workspace/notes");
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

  test("task search detail includes query-aware excerpt", () => {
    const detail = buildTaskSearchDetail(
      {
        date: "2026-03-07",
        time: "09:00",
        text: "Follow up on roadmap milestone alignment",
        filePath: "/tmp/moments/2026-03-07.md",
        relativePath: "moments/2026-03-07.md",
        fileLineIndex: 5,
        done: false,
      },
      "roadmap",
    );

    assert.ok(detail.includes("moments/2026-03-07.md:6"));
    assert.ok(detail.includes("roadmap milestone"));
  });

  test("moment tag extraction keeps unique normalized hashtags", () => {
    assert.deepStrictEqual(extractMomentTags("Discuss #AI and #notes with #AI again"), [
      "#ai",
      "#notes",
    ]);
    assert.deepStrictEqual(extractMomentTags("整理 #振り返り と #設計 をまとめる #振り返り"), [
      "#振り返り",
      "#設計",
    ]);
    assert.deepStrictEqual(extractMomentTags("整理 #振り返り－設計 と #振り返り-設計 を揃える"), [
      "#振り返り-設計",
    ]);
    assert.deepStrictEqual(extractMomentTags("No tags here"), []);
  });

  test("note metadata extracts Japanese inline hashtags", () => {
    const metadata = extractNoteMetadata(
      "# 週次レビュー\n日本語タグ #振り返り－設計 と #設計 を確認",
      "fallback-title",
    );

    assert.deepStrictEqual(metadata.tags, ["#振り返り-設計", "#設計"]);
  });

  test("inbox task filter narrows open and done items", () => {
    const items = [
      {
        date: "2026-03-07",
        time: "09:00",
        text: "Open task",
        filePath: "/tmp/moments/2026-03-07.md",
        relativePath: "moments/2026-03-07.md",
        fileLineIndex: 5,
        done: false,
      },
      {
        date: "2026-03-07",
        time: "10:00",
        text: "Done task",
        filePath: "/tmp/moments/2026-03-07.md",
        relativePath: "moments/2026-03-07.md",
        fileLineIndex: 8,
        done: true,
      },
    ];

    assert.deepStrictEqual(filterTaskOverviewItems(items, "open"), [items[0]]);
    assert.deepStrictEqual(filterTaskOverviewItems(items, "done"), [items[1]]);
    assert.deepStrictEqual(filterTaskOverviewItems(items, "all"), items);
  });

  test("inbox filter cycles all -> open -> done -> overdue -> all", () => {
    assert.strictEqual(getNextInboxFilter("all"), "open");
    assert.strictEqual(getNextInboxFilter("open"), "done");
    assert.strictEqual(getNextInboxFilter("done"), "overdue");
    assert.strictEqual(getNextInboxFilter("overdue"), "all");
  });

  test("invalid inbox filter setting falls back to all", () => {
    assert.strictEqual(normalizeInboxTaskFilter("invalid"), "all");
    assert.strictEqual(normalizeInboxTaskFilter("done"), "done");
    assert.strictEqual(normalizeInboxTaskFilter("overdue"), "overdue");
    assert.strictEqual(normalizeInboxTaskFilter(undefined), "all");
  });

  test("parseDueDate extracts date from 📅 and due: syntax", () => {
    assert.strictEqual(parseDueDate("Fix bug 📅2025-01-15"), "2025-01-15");
    assert.strictEqual(parseDueDate("Write report due:2025-01-20"), "2025-01-20");
    assert.strictEqual(parseDueDate("No date here"), null);
    assert.strictEqual(parseDueDate(""), null);
  });

  test("getDueDateStatus returns correct status", () => {
    assert.strictEqual(getDueDateStatus("2025-01-01", false, "2025-06-01"), "overdue");
    assert.strictEqual(getDueDateStatus("2025-06-01", false, "2025-06-01"), "today");
    assert.strictEqual(getDueDateStatus("2025-12-31", false, "2025-06-01"), "upcoming");
    assert.strictEqual(getDueDateStatus("2025-01-01", true, "2025-06-01"), null);
    assert.strictEqual(getDueDateStatus(null, false, "2025-06-01"), null);
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

  test("open Moments filter keeps only unfinished posts", () => {
    const filtered = filterMomentEntries(
      [
        { index: 0, time: "09:00", text: "todo", done: false },
        { index: 1, time: "09:30", text: "done", done: true },
        { index: 2, time: "10:00", text: "note", done: false },
      ],
      "open",
    );

    assert.deepStrictEqual(filtered, [
      { index: 0, time: "09:00", text: "todo", done: false },
      { index: 2, time: "10:00", text: "note", done: false },
    ]);
  });

  test("pinned Moments resolve against the latest feed entries", () => {
    const resolved = resolvePinnedEntries(
      [
        { date: "2026-03-09", index: 1, text: "stale text", time: "08:30" },
        { date: "2026-03-09", index: 9, text: "orphaned pin", time: "12:15" },
      ],
      [
        {
          date: "2026-03-09",
          dateLabel: "Today · 2026-03-09",
          isToday: true,
          entries: [{ index: 1, time: "09:45", text: "current text", done: true }],
        },
      ],
    );

    assert.deepStrictEqual(resolved, [
      {
        date: "2026-03-09",
        index: 1,
        text: "current text",
        time: "09:45",
        done: true,
        isAvailable: true,
      },
      {
        date: "2026-03-09",
        index: 9,
        text: "orphaned pin",
        time: "12:15",
        done: false,
        isAvailable: false,
      },
    ]);
  });

  test("open task overview is sorted by date and time desc", () => {
    const sorted = sortOpenTaskOverview([
      { date: "2026-03-06", time: "09:00", done: true },
      { date: "2026-03-07", time: "08:30", done: false },
      { date: "2026-03-07", time: "10:15", done: false },
      { date: "2026-03-07", time: "12:00", done: true },
    ]);

    assert.deepStrictEqual(sorted, [
      { date: "2026-03-07", time: "10:15", done: false },
      { date: "2026-03-07", time: "08:30", done: false },
      { date: "2026-03-07", time: "12:00", done: true },
      { date: "2026-03-06", time: "09:00", done: true },
    ]);
  });

  test("moment body index maps to file line after front matter", () => {
    const raw = "---\ntype: moments\ndate: 2026-03-07\n---\n\n- [ ] 09:00 task";
    assert.strictEqual(mapMomentBodyIndexToFileLine(raw, 1), 5);
  });

  test("moments date label only prefixes today", () => {
    assert.strictEqual(buildMomentsDateLabel("2026-03-09", "2026-03-09"), "Today · 2026-03-09");
    assert.strictEqual(buildMomentsDateLabel("2026-03-08", "2026-03-09"), "2026-03-08");
  });

  test("moments feed dates stack backward from the anchor date", () => {
    assert.deepStrictEqual(buildMomentsFeedDates("2026-03-09", 4), [
      "2026-03-09",
      "2026-03-08",
      "2026-03-07",
      "2026-03-06",
    ]);
  });

  test("moments feed day count is clamped to a practical range", () => {
    assert.strictEqual(normalizeMomentsFeedDayCount(undefined), 7);
    assert.strictEqual(normalizeMomentsFeedDayCount(0), 1);
    assert.strictEqual(normalizeMomentsFeedDayCount(4.8), 4);
    assert.strictEqual(normalizeMomentsFeedDayCount(80), 30);
  });

  test("task line toggle flips checkbox state", () => {
    assert.deepStrictEqual(toggleMomentTaskLine("- [ ] 09:00 task"), {
      line: "- [x] 09:00 task",
      changed: true,
    });
    assert.deepStrictEqual(toggleMomentTaskLine("- [x] 09:00 task"), {
      line: "- [ ] 09:00 task",
      changed: true,
    });
    assert.deepStrictEqual(toggleMomentTaskLine("- 09:00 note"), {
      line: "- [x] 09:00 note",
      changed: true,
    });
  });

  test("moment lines normalize to unchecked checkbox posts", () => {
    assert.deepStrictEqual(normalizeMomentLineToUnchecked("- 09:00 note"), {
      line: "- [ ] 09:00 note",
      changed: true,
    });
    assert.deepStrictEqual(normalizeMomentLineToUnchecked("- [x] 09:00 done task"), {
      line: "- [ ] 09:00 done task",
      changed: true,
    });
    assert.deepStrictEqual(normalizeMomentLineToUnchecked("- [ ] 09:00 task"), {
      line: "- [ ] 09:00 task",
      changed: false,
    });
    assert.deepStrictEqual(normalizeMomentLineToUnchecked("not a moment line"), {
      line: "not a moment line",
      changed: false,
    });
  });

  test("moment entry text replacement preserves time and task state", () => {
    assert.deepStrictEqual(replaceMomentEntryText("- [ ] 09:00 old task", "new task"), {
      line: "- [ ] 09:00 new task",
      changed: true,
    });
    assert.deepStrictEqual(replaceMomentEntryText("- [x] 09:00 done task", "updated done"), {
      line: "- [x] 09:00 updated done",
      changed: true,
    });
    assert.deepStrictEqual(replaceMomentEntryText("- 09:00 note text", "updated note"), {
      line: "- [ ] 09:00 updated note",
      changed: true,
    });
  });

  test("multiline moments round-trip through append and read", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    try {
      appendMoment(tmpDir, "2026-03-07", "First line\nSecond line\nThird line");
      const entries = readMoments(tmpDir, "2026-03-07");

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].text, "First line\nSecond line\nThird line");
      assert.deepStrictEqual(entries[0].tags, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("multiline moments save and delete operate on full blocks", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    const date = "2026-03-07";
    const filePath = getMomentsFilePath(tmpDir, date);

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        `---\ntype: moments\ndate: ${date}\n---\n\n- [ ] 09:00 First line\nSecond line\n- [ ] 09:30 Next entry\n`,
        "utf8",
      );

      assert.strictEqual(saveMomentEdit(tmpDir, date, 1, "Updated first\nUpdated second"), true);
      let entries = readMoments(tmpDir, date);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].text, "Updated first\nUpdated second");
      assert.strictEqual(entries[1].text, "Next entry");

      assert.strictEqual(deleteMomentEntry(tmpDir, date, 1), true);
      entries = readMoments(tmpDir, date);
      assert.deepStrictEqual(entries, [
        {
          index: 1,
          time: "09:30",
          text: "Next entry",
          done: false,
          tags: [],
        },
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("moments feed can load older visible days incrementally", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    const today = formatDate(new Date());
    const [todayDate, yesterdayDate, twoDaysAgoDate, threeDaysAgoDate] = buildMomentsFeedDates(today, 4);

    try {
      appendMoment(tmpDir, todayDate, "Today entry");
      fs.writeFileSync(
        getMomentsFilePath(tmpDir, yesterdayDate),
        `---\ntype: moments\ndate: ${yesterdayDate}\n---\n\n`,
        "utf8",
      );
      fs.writeFileSync(
        getMomentsFilePath(tmpDir, twoDaysAgoDate),
        `---\ntype: moments\ndate: ${twoDaysAgoDate}\n---\n\n- [ ] 09:00 Two days ago\n`,
        "utf8",
      );
      fs.writeFileSync(
        getMomentsFilePath(tmpDir, threeDaysAgoDate),
        `---\ntype: moments\ndate: ${threeDaysAgoDate}\n---\n\n- [ ] 08:00 Three days ago\n`,
        "utf8",
      );

      const initial = collectMomentsFeed(tmpDir, today, 2);
      assert.deepStrictEqual(initial.sections.map((section) => section.date), [
        todayDate,
        twoDaysAgoDate,
      ]);
      assert.strictEqual(initial.hasMoreOlder, true);

      const expanded = collectMomentsFeed(tmpDir, today, 3);
      assert.deepStrictEqual(expanded.sections.map((section) => section.date), [
        todayDate,
        twoDaysAgoDate,
        threeDaysAgoDate,
      ]);
      assert.strictEqual(expanded.hasMoreOlder, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("moment line deletion removes only the targeted line", () => {
    assert.deepStrictEqual(deleteMomentLine(["a", "b", "c"], 1), {
      lines: ["a", "c"],
      changed: true,
    });
    assert.deepStrictEqual(deleteMomentLine(["a", "b", "c"], 10), {
      lines: ["a", "b", "c"],
      changed: false,
    });
  });

  test("notes watcher pattern is scoped to notes directory", () => {
    const notesDir = path.join("/tmp", "notes");
    const pattern = createNotesWatcherPattern(notesDir);

    assert.ok(pattern instanceof vscode.RelativePattern);
    assert.strictEqual(pattern.baseUri.fsPath, notesDir);
    assert.strictEqual(pattern.pattern, "**/*.md");
    assert.strictEqual(createNotesWatcherPattern(undefined), undefined);
  });

  test("formatDateYMD zero-pads month and day", () => {
    assert.strictEqual(formatDateYMD(new Date(2024, 0, 5)), "2024-01-05");
    assert.strictEqual(formatDateYMD(new Date(2025, 11, 31)), "2025-12-31");
    assert.strictEqual(formatDateYMD(new Date(2000, 0, 1)), "2000-01-01");
  });

  test("resolveUniqueFilePath returns original path when no collision", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-test-"));
    try {
      const result = resolveUniqueFilePath(tmpDir, "note.md");
      assert.strictEqual(result, path.join(tmpDir, "note.md"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("resolveUniqueFilePath appends -2 suffix on single collision", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "note.md"), "");
      const result = resolveUniqueFilePath(tmpDir, "note.md");
      assert.strictEqual(result, path.join(tmpDir, "note-2.md"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("resolveUniqueFilePath increments counter past all existing suffixes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "note.md"), "");
      fs.writeFileSync(path.join(tmpDir, "note-2.md"), "");
      const result = resolveUniqueFilePath(tmpDir, "note.md");
      assert.strictEqual(result, path.join(tmpDir, "note-3.md"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("moments feed dates returns single entry when feedDays is 1", () => {
    assert.deepStrictEqual(buildMomentsFeedDates("2026-03-09", 1), ["2026-03-09"]);
  });

  test("moments feed dates with feedDays=30 starts at anchor and ends 29 days earlier", () => {
    const dates = buildMomentsFeedDates("2026-03-31", 30);
    assert.strictEqual(dates.length, 30);
    assert.strictEqual(dates[0], "2026-03-31");
    assert.strictEqual(dates[29], "2026-03-02");
  });

  test("moment body index maps correctly without front matter", () => {
    const raw = "- [ ] 09:00 first\n- 10:00 second";
    assert.strictEqual(mapMomentBodyIndexToFileLine(raw, 0), 0);
    assert.strictEqual(mapMomentBodyIndexToFileLine(raw, 1), 1);
  });

  test("normalizeMomentsFeedDayCount clamps edge cases including NaN and Infinity", () => {
    assert.strictEqual(normalizeMomentsFeedDayCount(NaN), 7);
    assert.strictEqual(normalizeMomentsFeedDayCount(Infinity), 7);
    assert.strictEqual(normalizeMomentsFeedDayCount(-5), 1);
    assert.strictEqual(normalizeMomentsFeedDayCount(1), 1);
    assert.strictEqual(normalizeMomentsFeedDayCount(30), 30);
  });

  test("normalizeInboxTaskFilter treats empty string as invalid and returns all", () => {
    assert.strictEqual(normalizeInboxTaskFilter(""), "all");
    assert.strictEqual(normalizeInboxTaskFilter("open"), "open");
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
