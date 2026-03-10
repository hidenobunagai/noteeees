import * as assert from "assert";
import * as path from "path";
import { buildTagSearchItems, createNotesWatcherPattern } from "../extension";
import {
  buildMomentsFeedDates,
  buildMomentsDateLabel,
  buildTaskSearchDetail,
  deleteMomentLine,
  filterMomentEntries,
  filterTaskOverviewItems,
  getNextInboxFilter,
  mapMomentBodyIndexToFileLine,
  normalizeInboxTaskFilter,
  replaceMomentEntryText,
  sortOpenTaskOverview,
  toggleMomentTaskLine,
} from "../momentsPanel";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import {
  buildNoteSearchDetail,
  buildQueryExcerpt,
  extractNoteMetadata,
  extractPreviewText,
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

  test("inbox filter cycles all -> open -> done -> all", () => {
    assert.strictEqual(getNextInboxFilter("all"), "open");
    assert.strictEqual(getNextInboxFilter("open"), "done");
    assert.strictEqual(getNextInboxFilter("done"), "all");
  });

  test("invalid inbox filter setting falls back to all", () => {
    assert.strictEqual(normalizeInboxTaskFilter("invalid"), "all");
    assert.strictEqual(normalizeInboxTaskFilter("done"), "done");
    assert.strictEqual(normalizeInboxTaskFilter(undefined), "all");
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

  test("open task filter keeps only unfinished tasks", () => {
    const filtered = filterMomentEntries(
      [
        { index: 0, time: "09:00", text: "todo", isTask: true, done: false },
        { index: 1, time: "09:30", text: "done", isTask: true, done: true },
        { index: 2, time: "10:00", text: "note", isTask: false, done: false },
      ],
      "openTasks",
    );

    assert.deepStrictEqual(filtered, [
      { index: 0, time: "09:00", text: "todo", isTask: true, done: false },
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
      line: "- 09:00 note",
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
      line: "- 09:00 updated note",
      changed: true,
    });
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
