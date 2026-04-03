import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildDashboardCandidateViews,
  buildDashboardListItems,
  buildDashboardTaskViews,
  countDashboardListItemsForFilter,
  canAddDashboardCandidate,
  buildUpcomingWeek,
  classifyDashboardTask,
  DashboardPanel,
  type DashboardListItem,
  filterExtractedTasksForDisplay,
  matchesDashboardListItemFilter,
  normalizeExtractedTaskIdentity,
  normalizeDashboardTaskText,
  resolveDashboardTaskFile,
  upsertDashboardDueDate,
} from "../dashboardPanel";
import {
  buildTagSearchItems,
  createNotesWatcherPattern,
  resolveNotesDirectory,
} from "../extension";
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

function createMementoStub(): vscode.Memento & { setKeysForSync(keys: readonly string[]): void } {
  const store = new Map<string, unknown>();

  return {
    get<T>(key: string, defaultValue?: T): T {
      if (!store.has(key)) {
        return defaultValue as T;
      }

      return store.get(key) as T;
    },
    keys(): readonly string[] {
      return Array.from(store.keys());
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    setKeysForSync(_keys: readonly string[]): void {
      return;
    },
  };
}

function createExtensionContextStub(): vscode.ExtensionContext {
  const context = {
    globalState: createMementoStub(),
  } satisfies Pick<vscode.ExtensionContext, "globalState">;

  return context as vscode.ExtensionContext;
}

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

function renderDashboardWebviewHtml(): string {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-dashboard-"));
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

  const panel = {
    webview,
    onDidDispose(_listener: () => void): vscode.Disposable {
      return new vscode.Disposable(() => undefined);
    },
    reveal(): void {
      return;
    },
    dispose(): void {
      return;
    },
  } satisfies Pick<vscode.WebviewPanel, "webview" | "onDidDispose" | "reveal" | "dispose">;

  const DashboardPanelCtor = DashboardPanel as unknown as {
    new (
      panel: vscode.WebviewPanel,
      getNotesDir: () => string | undefined,
      extensionUri: vscode.Uri,
      stateStore: vscode.Memento,
    ): unknown;
  };

  try {
    new DashboardPanelCtor(
      panel as vscode.WebviewPanel,
      () => notesDir,
      vscode.Uri.file(notesDir),
      createMementoStub(),
    );
    return webview.html;
  } finally {
    fs.rmSync(notesDir, { recursive: true, force: true });
  }
}

function createDashboardPanelTestHarness(): {
  notesDir: string;
  panel: DashboardPanel;
  cleanup: () => void;
} {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-dashboard-"));
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

  const panelStub = {
    webview,
    onDidDispose(_listener: () => void): vscode.Disposable {
      return new vscode.Disposable(() => undefined);
    },
    reveal(): void {
      return;
    },
    dispose(): void {
      return;
    },
  } satisfies Pick<vscode.WebviewPanel, "webview" | "onDidDispose" | "reveal" | "dispose">;

  const DashboardPanelCtor = DashboardPanel as unknown as {
    new (
      panel: vscode.WebviewPanel,
      getNotesDir: () => string | undefined,
      extensionUri: vscode.Uri,
      stateStore: vscode.Memento,
    ): DashboardPanel;
  };

  const panel = new DashboardPanelCtor(
    panelStub as vscode.WebviewPanel,
    () => notesDir,
    vscode.Uri.file(notesDir),
    createMementoStub(),
  );

  return {
    notesDir,
    panel,
    cleanup() {
      fs.rmSync(notesDir, { recursive: true, force: true });
    },
  };
}

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

  test("parseDueDate extracts date from 📅, due:, and @ syntax", () => {
    assert.strictEqual(parseDueDate("Fix bug 📅2025-01-15"), "2025-01-15");
    assert.strictEqual(parseDueDate("Write report due:2025-01-20"), "2025-01-20");
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
      inputAreaRule.includes("border-bottom: 1px solid var(--vscode-panel-border);"),
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

  test("dashboard webview persists notes extraction state alongside moments state", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("notesFromDate: state.notesFromDate"),
      "expected persisted state to include notesFromDate",
    );
    assert.ok(
      html.includes("notesToDate: state.notesToDate"),
      "expected persisted state to include notesToDate",
    );
    assert.ok(
      html.includes("notesExtractedTasks: state.notesExtractedTasks"),
      "expected persisted state to include notesExtractedTasks",
    );
    assert.ok(
      html.includes("notesAddedExtractedKeys: state.notesAddedExtractedKeys"),
      "expected persisted state to include notesAddedExtractedKeys",
    );
    assert.ok(
      html.includes("notesAiStatus: state.notesAiStatus"),
      "expected persisted state to include notesAiStatus",
    );
    assert.ok(
      html.includes("notesAiStatusType: state.notesAiStatusType"),
      "expected persisted state to include notesAiStatusType",
    );
  });

  test("dashboard webview defines a browser-side candidate add guard", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("function canAddDashboardCandidate(task, existingTaskKeys)"),
      "expected dashboard script to define canAddDashboardCandidate in browser scope",
    );
    assert.ok(
      html.includes("return !task.existsAlready;"),
      "expected browser-side guard to preserve the snapshot fallback logic",
    );
  });

  test("dashboard webview persists extracted results immediately on message receipt", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("state.extractedTasks = message.tasks || [];\n        state.addedExtractedKeys = [];\n        persistState();\n        renderAiResult();"),
      "expected extractResult handler to persist state before rendering",
    );
    assert.ok(
      html.includes("state.notesExtractedTasks = message.tasks || [];\n        state.notesAddedExtractedKeys = [];\n        persistState();\n        renderNotesExtractResult();"),
      "expected notesExtractResult handler to persist state before rendering",
    );
  });

  test("addExtractedTask does not create a duplicate saved task when identity already exists", () => {
    const harness = createDashboardPanelTestHarness();

    try {
      const inboxPath = path.join(harness.notesDir, "tasks", "inbox.md");
      fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
      fs.writeFileSync(
        inboxPath,
        "---\ntype: tasks\n---\n\n- [ ] Send report @2026-03-30\n",
        "utf8",
      );

      (harness.panel as unknown as { _handleMessage(message: Record<string, unknown>): void })._handleMessage({
        command: "addExtractedTask",
        text: "Send report",
        dueDate: "2026-03-31",
        targetDate: null,
      });

      const contents = fs.readFileSync(inboxPath, "utf8");
      const taskLines = contents.split("\n").filter((line) => line.startsWith("- [ ] "));
      assert.deepStrictEqual(taskLines, ["- [ ] Send report @2026-03-30"]);
    } finally {
      harness.cleanup();
    }
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
    const [todayDate, yesterdayDate, twoDaysAgoDate, threeDaysAgoDate] = buildMomentsFeedDates(
      today,
      4,
    );

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
      assert.deepStrictEqual(
        initial.sections.map((section) => section.date),
        [todayDate, twoDaysAgoDate],
      );
      assert.strictEqual(initial.hasMoreOlder, true);

      const expanded = collectMomentsFeed(tmpDir, today, 3);
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

  test("notes watcher pattern is scoped to notes directory", () => {
    const notesDir = path.join("/tmp", "notes");
    const pattern = createNotesWatcherPattern(notesDir);

    assert.ok(pattern instanceof vscode.RelativePattern);
    assert.strictEqual(pattern.baseUri.fsPath, notesDir);
    assert.strictEqual(pattern.pattern, "**/*.md");
    assert.strictEqual(createNotesWatcherPattern(undefined), undefined);
  });

  test("dashboard task text normalization collapses multiline input", () => {
    assert.strictEqual(
      normalizeDashboardTaskText("  first line  \n\n second line \nthird "),
      "first line / second line / third",
    );
  });

  test("dashboard due date upsert replaces existing markers", () => {
    assert.strictEqual(
      upsertDashboardDueDate("Follow up due:2026-03-01 #work", "2026-03-05"),
      "Follow up #work @2026-03-05",
    );
    assert.strictEqual(upsertDashboardDueDate("Review spec @2026-03-01", null), "Review spec");
  });

  test("normalizeExtractedTaskIdentity collapses due markers and formatting noise", () => {
    assert.strictEqual(
      normalizeExtractedTaskIdentity("  Send   report due:2026-04-01  "),
      "send report",
    );
    assert.strictEqual(normalizeExtractedTaskIdentity("整理する @2026-04-02"), "整理する");
  });

  test("filterExtractedTasksForDisplay hides dismissed and duplicate candidates but keeps existing matches visible", () => {
    const result = filterExtractedTasksForDisplay(
      [
        {
          text: "Send report",
          category: "work",
          priority: "high",
          timeEstimateMin: 30,
          dueDate: null,
        },
        {
          text: "Review budget",
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          dueDate: null,
        },
        {
          text: "Review budget due:2026-03-31",
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          dueDate: "2026-03-31",
        },
        {
          text: "Organize receipts",
          category: "admin",
          priority: "low",
          timeEstimateMin: 15,
          dueDate: null,
        },
      ],
      [
        {
          id: "tasks/inbox.md:1",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 1,
          text: "Send report @2026-03-30",
          done: false,
          date: null,
          dueDate: "2026-03-30",
          tags: [],
        },
      ],
      [
        {
          key: normalizeExtractedTaskIdentity("Organize receipts"),
          dismissedAt: "2026-03-20",
        },
      ],
      "2026-03-27",
    );

    assert.deepStrictEqual(result.visibleTasks.map((task) => task.text), ["Send report", "Review budget"]);
    assert.strictEqual((result.visibleTasks[0] as { existsAlready?: boolean }).existsAlready, true);
    assert.strictEqual((result.visibleTasks[1] as { existsAlready?: boolean }).existsAlready, false);
    assert.strictEqual(result.hiddenExisting, 0);
    assert.strictEqual(result.hiddenDismissed, 1);
    assert.strictEqual(result.hiddenDuplicates, 1);
  });

  test("filterExtractedTasksForDisplay keeps existing-task duplicates as visible disabled candidates", () => {
    const result = filterExtractedTasksForDisplay(
      [
        {
          text: "Send report",
          category: "work",
          priority: "high",
          timeEstimateMin: 30,
          dueDate: null,
        },
        {
          text: "Review budget",
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          dueDate: "2026-03-31",
        },
        {
          text: "Review budget due:2026-03-31",
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          dueDate: "2026-03-31",
        },
        {
          text: "Organize receipts",
          category: "admin",
          priority: "low",
          timeEstimateMin: 15,
          dueDate: null,
        },
      ],
      [
        {
          id: "tasks/inbox.md:1",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 1,
          text: "Send report @2026-03-30",
          done: false,
          date: null,
          dueDate: "2026-03-30",
          tags: [],
        },
      ],
      [
        {
          key: normalizeExtractedTaskIdentity("Organize receipts"),
          dismissedAt: "2026-03-20",
        },
      ],
      "2026-03-27",
    );

    assert.deepStrictEqual(result.visibleTasks.map((task) => task.text), [
      "Send report",
      "Review budget",
    ]);
    assert.strictEqual("existsAlready" in result.visibleTasks[0], true);
    assert.strictEqual((result.visibleTasks[0] as { existsAlready?: boolean }).existsAlready, true);
    assert.strictEqual((result.visibleTasks[1] as { existsAlready?: boolean }).existsAlready, false);
    assert.strictEqual(result.hiddenExisting, 0);
    assert.strictEqual(result.hiddenDismissed, 1);
    assert.strictEqual(result.hiddenDuplicates, 1);
  });

  test("canAddDashboardCandidate rejects already-existing candidates", () => {
    assert.strictEqual(
      canAddDashboardCandidate({
        kind: "candidate",
        text: "Send report",
        dueDate: null,
        category: "work",
        priority: "high",
        timeEstimateMin: 30,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: true,
      }),
      false,
    );

    assert.strictEqual(
      canAddDashboardCandidate({
        kind: "candidate",
        text: "Review budget",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 20,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      }, new Set([normalizeExtractedTaskIdentity("Review budget @2026-03-31")])),
      false,
    );

    assert.strictEqual(
      canAddDashboardCandidate({
        kind: "candidate",
        text: "Review budget",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 20,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      }),
      true,
    );
  });

  test("filterExtractedTasksForDisplay preserves notes candidate source metadata", () => {
    const result = filterExtractedTasksForDisplay(
      [
        {
          text: "Plan retro",
          category: "work",
          priority: "medium",
          timeEstimateMin: 25,
          dueDate: null,
          sourceNote: "projects/retro.md",
        },
      ],
      [
        {
          id: "tasks/inbox.md:4",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 4,
          text: "Plan retro @2026-03-29",
          done: false,
          date: null,
          dueDate: "2026-03-29",
          tags: [],
        },
      ],
      [],
      "2026-03-27",
    );

    assert.strictEqual(result.visibleTasks.length, 1);
    assert.strictEqual(result.visibleTasks[0].source, "notes");
    assert.strictEqual(result.visibleTasks[0].sourceLabel, "projects/retro.md");
    assert.strictEqual(result.visibleTasks[0].existsAlready, true);
    assert.strictEqual(
      canAddDashboardCandidate(result.visibleTasks[0], new Set([normalizeExtractedTaskIdentity("Plan retro")])) ,
      false,
    );
  });

  test("candidate filter routes candidate and saved task rows correctly", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Overdue saved",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: ["#work"],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: ["#admin"],
        },
        {
          id: "tasks/inbox.md:3",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 3,
          text: "Done saved",
          done: true,
          date: null,
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidateViews = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Candidate first",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
      {
        kind: "candidate",
        text: "Candidate second",
        dueDate: "2026-03-29",
        category: "admin",
        priority: "low",
        timeEstimateMin: 10,
        source: "notes",
        sourceLabel: "projects/plan.md",
        existsAlready: false,
      },
    ]);
    const listItems = buildDashboardListItems(savedTasks, candidateViews);
    const visibleAll = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "all"),
    );
    const visibleCandidates = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "candidate"),
    );
    const visibleAttention = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "attention"),
    );

    assert.deepStrictEqual(
      visibleAll.map((item) => item.text),
      ["Overdue saved", "Today saved", "Done saved", "Candidate first", "Candidate second"],
    );
    assert.deepStrictEqual(
      visibleCandidates.map((item) => item.text),
      ["Candidate first", "Candidate second"],
    );

    for (const filter of ["overdue", "today", "upcoming", "scheduled", "backlog", "done"] as const) {
      assert.strictEqual(
        listItems.some(
          (item: DashboardListItem) =>
            item.kind === "candidate" && matchesDashboardListItemFilter(item, filter),
        ),
        false,
      );
    }

    assert.deepStrictEqual(
      visibleAttention.map((item) => item.text),
      ["Overdue saved", "Today saved"],
    );
  });

  test("candidate filter counts candidate rows only", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-27.md:1",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 1,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidateViews = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Candidate first",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
      {
        kind: "candidate",
        text: "Candidate second",
        dueDate: null,
        category: "work",
        priority: "low",
        timeEstimateMin: 10,
        source: "notes",
        sourceLabel: "projects/plan.md",
        existsAlready: false,
      },
    ]);

    const listItems = buildDashboardListItems(savedTasks, candidateViews);

    assert.strictEqual(countDashboardListItemsForFilter(listItems, "candidate"), 2);
    assert.strictEqual(countDashboardListItemsForFilter(listItems, "all"), 3);
    assert.strictEqual(countDashboardListItemsForFilter(listItems, "attention"), 1);
  });

  test("dashboard task file resolver supports inbox and dated files", () => {
    const notesDir = "/tmp/notes";
    assert.strictEqual(resolveDashboardTaskFile(notesDir, null), "/tmp/notes/tasks/inbox.md");
    assert.strictEqual(
      resolveDashboardTaskFile(notesDir, "2026-03-31"),
      "/tmp/notes/tasks/2026-03-31.md",
    );
  });

  test("dashboard task classifier separates backlog upcoming and overdue", () => {
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "tasks/inbox.md:1",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 1,
          text: "Inbox task",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "backlog",
    );
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "tasks/2026-03-27.md:4",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 4,
          text: "Due soon",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-30",
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "upcoming",
    );
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "tasks/2026-03-20.md:2",
          filePath: "/tmp/notes/tasks/2026-03-20.md",
          lineIndex: 2,
          text: "Overdue task",
          done: false,
          date: "2026-03-20",
          dueDate: null,
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "overdue",
    );
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "projects/roadmap.md:9",
          filePath: "/tmp/notes/projects/roadmap.md",
          lineIndex: 9,
          text: "Done item",
          done: true,
          date: null,
          dueDate: "2026-03-30",
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "done",
    );
  });

  test("upcoming week chart uses the next 7 days and effective dates", () => {
    const week = buildUpcomingWeek(
      [
        {
          id: "tasks/2026-03-27.md:1",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 1,
          text: "Today task",
          done: false,
          date: "2026-03-27",
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/2026-03-28.md:1",
          filePath: "/tmp/notes/tasks/2026-03-28.md",
          lineIndex: 1,
          text: "Due later",
          done: false,
          date: "2026-03-28",
          dueDate: "2026-03-30",
          tags: [],
        },
        {
          id: "tasks/2026-03-30.md:4",
          filePath: "/tmp/notes/tasks/2026-03-30.md",
          lineIndex: 4,
          text: "Already finished",
          done: true,
          date: "2026-03-30",
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/2026-04-03.md:2",
          filePath: "/tmp/notes/tasks/2026-04-03.md",
          lineIndex: 2,
          text: "Outside window",
          done: false,
          date: "2026-04-03",
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/inbox.md:7",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 7,
          text: "Backlog",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );

    assert.deepStrictEqual(
      week.map((day) => day.date),
      [
        "2026-03-27",
        "2026-03-28",
        "2026-03-29",
        "2026-03-30",
        "2026-03-31",
        "2026-04-01",
        "2026-04-02",
      ],
    );
    assert.deepStrictEqual(
      week.map((day) => ({ date: day.date, open: day.open, done: day.done })),
      [
        { date: "2026-03-27", open: 1, done: 0 },
        { date: "2026-03-28", open: 0, done: 0 },
        { date: "2026-03-29", open: 0, done: 0 },
        { date: "2026-03-30", open: 1, done: 1 },
        { date: "2026-03-31", open: 0, done: 0 },
        { date: "2026-04-01", open: 0, done: 0 },
        { date: "2026-04-02", open: 0, done: 0 },
      ],
    );
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
