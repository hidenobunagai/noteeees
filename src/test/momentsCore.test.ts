import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  appendMoment,
  collectMomentsFeed,
  deleteMomentEntry,
  formatDate,
  getMomentsFilePath,
  readMoments,
  saveMomentEdit,
} from "../moments/fileIo";
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
  MomentsViewProvider,
  normalizeInboxTaskFilter,
  normalizeMomentLineToUnchecked,
  normalizeMomentsFeedDayCount,
  parseDueDate,
  replaceMomentEntryText,
  resolvePinnedEntries,
  sortOpenTaskOverview,
  toggleMomentTaskLine,
} from "../momentsPanel";
import { createExtensionContextStub } from "./dashboardTestHelpers";

function renderMomentsWebviewHtml(): string {
  const webview: Pick<
    vscode.Webview,
    "cspSource" | "html" | "options" | "asWebviewUri" | "onDidReceiveMessage" | "postMessage"
  > = {
    cspSource: "vscode-webview-resource://test",
    html: "",
    options: {},
    asWebviewUri(uri: vscode.Uri): vscode.Uri {
      return uri;
    },
    onDidReceiveMessage<T>(_listener: (e: T) => unknown): vscode.Disposable {
      return new vscode.Disposable(() => undefined);
    },
    postMessage(): Thenable<boolean> {
      return Promise.resolve(true);
    },
  };

  const webviewView = {
    webview,
    show(_preserveFocus?: boolean): void {
      return;
    },
  } satisfies Pick<vscode.WebviewView, "webview" | "show">;

  const provider = new MomentsViewProvider(
    () => undefined,
    vscode.Uri.file("/tmp/noteeees-tests"),
    createExtensionContextStub(),
  );

  provider.resolveWebviewView(
    webviewView as vscode.WebviewView,
    {} as vscode.WebviewViewResolveContext,
    {} as vscode.CancellationToken,
  );

  return webview.html;
}

suite("Moments Core Test Suite", () => {
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

  test("parseDueDate extracts date from 📅, due:, #due:, and @ syntax", () => {
    assert.strictEqual(parseDueDate("Fix bug 📅2025-01-15"), "2025-01-15");
    assert.strictEqual(parseDueDate("Write report due:2025-01-20"), "2025-01-20");
    assert.strictEqual(parseDueDate("Triage #due:2025-01-25"), "2025-01-25");
    assert.strictEqual(parseDueDate("MTG with team @2026-03-31"), "2026-03-31");
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

  test("Moments webview renders the composer before the timeline", () => {
    const html = renderMomentsWebviewHtml();
    const topbarIndex = html.indexOf('<div class="topbar">');
    const inputIndex = html.indexOf('<div class="input-area">');
    const timelineIndex = html.indexOf('<div class="timeline" id="timeline">');

    assert.ok(topbarIndex >= 0, "expected topbar markup to be present");
    assert.ok(inputIndex >= 0, "expected composer markup to be present");
    assert.ok(timelineIndex >= 0, "expected timeline markup to be present");
    assert.ok(topbarIndex < inputIndex, "expected the composer to remain below the topbar");
    assert.ok(inputIndex < timelineIndex, "expected the composer to render above the timeline");
  });

  test("Moments webview uses a bottom divider below the top composer", () => {
    const html = renderMomentsWebviewHtml();
    const inputAreaRuleMatch = html.match(/\.input-area\s*\{[^}]*\}/s);

    assert.ok(inputAreaRuleMatch, "expected the .input-area CSS rule to be present");
    const inputAreaRule = inputAreaRuleMatch[0];
    assert.ok(
      inputAreaRule.includes("border-bottom:") && inputAreaRule.includes("var(--moments-border)"),
      "expected the top composer to divide from the timeline below it",
    );
    assert.ok(
      !inputAreaRule.includes("border-top:"),
      "expected the top composer to avoid a duplicate border under the topbar",
    );
  });

  test("Moments webview preserves the inline due date highlight regex", () => {
    const html = renderMomentsWebviewHtml();

    assert.ok(
      html.includes("html = html.replace(/@(\\d{4}-\\d{2}-\\d{2})/g"),
      "expected the webview script to preserve the due date regex escapes",
    );
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
      line: "- 09:00 new task",
      changed: true,
    });
    assert.deepStrictEqual(replaceMomentEntryText("- [x] 09:00 done task", "updated done"), {
      line: "- 09:00 updated done",
      changed: true,
    });
    assert.deepStrictEqual(replaceMomentEntryText("- 09:00 note text", "updated note"), {
      line: "- 09:00 updated note",
      changed: true,
    });
  });

  test("multiline moments round-trip through append and read", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    try {
      await appendMoment(tmpDir, "2026-03-07", "First line\nSecond line\nThird line");
      const entries = await readMoments(tmpDir, "2026-03-07");

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].text, "First line\nSecond line\nThird line");
      assert.deepStrictEqual(entries[0].tags, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("multiline moments save and delete operate on full blocks", async () => {
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

      assert.strictEqual(
        await saveMomentEdit(tmpDir, date, 1, "Updated first\nUpdated second"),
        true,
      );
      let entries = await readMoments(tmpDir, date);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].text, "Updated first\nUpdated second");
      assert.strictEqual(entries[1].text, "Next entry");

      assert.strictEqual(await deleteMomentEntry(tmpDir, date, 1), true);
      entries = await readMoments(tmpDir, date);
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

  test("moments feed can load older visible days incrementally", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    const today = formatDate(new Date());
    const [todayDate, yesterdayDate, twoDaysAgoDate, threeDaysAgoDate] = buildMomentsFeedDates(
      today,
      4,
    );

    try {
      await appendMoment(tmpDir, todayDate, "Today entry");
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

      const initial = await collectMomentsFeed(tmpDir, today, 2);
      assert.deepStrictEqual(
        initial.sections.map((section) => section.date),
        [todayDate, twoDaysAgoDate],
      );
      assert.strictEqual(initial.hasMoreOlder, true);

      const expanded = await collectMomentsFeed(tmpDir, today, 3);
      assert.deepStrictEqual(
        expanded.sections.map((section) => section.date),
        [todayDate, twoDaysAgoDate, threeDaysAgoDate],
      );
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
});
