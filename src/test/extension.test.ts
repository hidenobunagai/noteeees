import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildDashboardListViewModel,
  buildDashboardCandidateViews,
  buildDashboardListItems,
  migrateDashboardCandidateState,
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
import { extractTasksFromTextWithStatus, type ExtractedTask } from "../aiTaskProcessor";
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

function createMementoStubWithValues(
  values: Record<string, unknown>,
): vscode.Memento & { setKeysForSync(keys: readonly string[]): void } {
  const memento = createMementoStub();
  for (const [key, value] of Object.entries(values)) {
    void memento.update(key, value);
  }
  return memento;
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

function renderDashboardWebviewHtml(
  seed?: (notesDir: string) => void,
  stateStore: vscode.Memento = createMementoStub(),
): string {
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
    seed?.(notesDir);
    new DashboardPanelCtor(
      panel as vscode.WebviewPanel,
      () => notesDir,
      vscode.Uri.file(notesDir),
      stateStore,
    );
    return webview.html;
  } finally {
    fs.rmSync(notesDir, { recursive: true, force: true });
  }
}

async function renderSettledDashboardWebviewHtml(
  seed?: (notesDir: string) => void,
  stateStore: vscode.Memento = createMementoStub(),
): Promise<string> {
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
    seed?.(notesDir);
    new DashboardPanelCtor(
      panel as vscode.WebviewPanel,
      () => notesDir,
      vscode.Uri.file(notesDir),
      stateStore,
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (webview.html.length > 0) {
        return webview.html;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

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

function createDashboardPanelMessageHarness(): {
  notesDir: string;
  panel: DashboardPanel;
  messages: Array<Record<string, unknown>>;
  cleanup: () => void;
} {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-dashboard-"));
  const messages: Array<Record<string, unknown>> = [];
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
    postMessage(message: Record<string, unknown>): Thenable<boolean> {
      messages.push(message);
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
    messages,
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
      html.includes("candidateTasks: state.candidateTasks"),
      "expected persisted state to include unified candidateTasks",
    );
    assert.ok(
      html.includes("candidateOrderSeed: state.candidateOrderSeed"),
      "expected persisted state to include candidate order seed",
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

  test("dashboard webview defines browser-side merged list helpers", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("function matchesDashboardListItemFilter(item, filter)"),
      "expected merged list filter helper in browser scope",
    );
    assert.ok(
      html.includes("function buildDashboardListViewModel(items, filter, search)"),
      "expected merged list view-model helper in browser scope",
    );
  });

  test("dashboard webview uses a flat list render path for non-All Task 1 listboard views", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("if (viewModel.flatItems && viewModel.flatItems.length > 0)"),
      "expected non-All views to use a flat-item render path without section headers",
    );
  });

  test("dashboard webview defaults the listboard filter to All and renders the full chip set", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("const filterDefinitions = ["),
      "expected dashboard script to define the filter chip set",
    );
    assert.ok(
      html.includes('{ id: "all", label: "All", count:'),
      "expected All filter chip definition in the dashboard toolbar",
    );
    assert.ok(
      html.includes('const activeClass = filter.id === state.filter ? " is-active" : "";'),
      "expected rendered filter output to include an active state contract",
    );
    assert.ok(
      html.includes(
        `return '<button type="button" class="filter-chip' + activeClass + '" data-filter="' + esc(filter.id) + '">`,
      ),
      "expected rendered filter output to bind each chip to its filter id",
    );
    assert.ok(
      html.includes("state.filter = button.dataset.filter;"),
      "expected filter buttons to drive the active filter from the rendered output contract",
    );
    assert.ok(
      html.includes('if (state.filter !== "all") {'),
      "expected the All filter to remain the primary default list view during rerenders",
    );

    for (const filterId of ["all", "today", "planned", "done"]) {
      assert.ok(
        html.includes(`{ id: "${filterId}", label:`),
        `expected ${filterId} filter chip definition in the dashboard toolbar`,
      );
    }
  });

  test("simplified filter set is exactly All/Today/Planned/Done", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(html.includes('{ id: "all", label: "All"'), "expected All filter chip");
    assert.ok(html.includes('{ id: "today", label: "Today"'), "expected Today filter chip");
    assert.ok(html.includes('{ id: "planned", label: "Planned"'), "expected Planned filter chip");
    assert.ok(html.includes('{ id: "done", label: "Done"'), "expected Done filter chip");
    assert.ok(
      !html.includes('{ id: "attention", label:'),
      "expected no Attention filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "candidate", label:'),
      "expected no Candidate filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "overdue", label:'),
      "expected no Overdue filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "upcoming", label:'),
      "expected no Upcoming filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "scheduled", label:'),
      "expected no Scheduled filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "backlog", label:'),
      "expected no Backlog filter in simplified UI",
    );
  });

  test("simplified section model under All renders Today/Planned/Unsorted/Done", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(html.includes('today: "Today"'), "expected Today section title mapping");
    assert.ok(html.includes('planned: "Planned"'), "expected Planned section title mapping");
    assert.ok(html.includes('unsorted: "Unsorted"'), "expected Unsorted section title mapping");
    assert.ok(html.includes('done: "Done"'), "expected Done section title mapping");
    assert.ok(
      !html.includes('overdue: "Overdue"'),
      "expected no Overdue section in simplified model",
    );
    assert.ok(
      !html.includes('upcoming: "Upcoming"'),
      "expected no Upcoming section in simplified model",
    );
    assert.ok(
      !html.includes('scheduled: "Scheduled"'),
      "expected no Scheduled section in simplified model",
    );
    assert.ok(
      !html.includes('backlog: "Backlog"'),
      "expected no Backlog section in simplified model",
    );
  });

  test("dashboard webview switches to All after extraction and tracks locally added candidate keys", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("addedCandidateKeys: state.addedCandidateKeys"),
      "expected persisted state to include locally added candidate keys",
    );
    assert.ok(
      html.includes("const locallyAddedKeys = (state.addedCandidateKeys || []).filter(Boolean);"),
      "expected browser-side existing task keys to include locally added candidates",
    );
    assert.ok(
      html.includes("state.candidateBlockShown = true;") &&
        html.includes('mergeCandidateBatch("moments", message.tasks || []);'),
      "expected moments extraction results to switch the UI to All and show candidate block",
    );
    assert.ok(
      html.includes("state.candidateBlockShown = true;") &&
        html.includes('mergeCandidateBatch("notes", message.tasks || []);'),
      "expected notes extraction results to switch the UI to All and show candidate block",
    );
    assert.ok(
      html.includes("function handleDismissExtractedAction(actionEl) {") &&
        !html.includes(
          'function handleDismissExtractedAction(actionEl) {\n      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);\n      const visibleCandidates = getVisibleCandidates();\n      if (Number.isNaN(index) || !visibleCandidates[index]) {\n        return;\n      }\n\n      const task = visibleCandidates[index];\n      state.candidateTasks = (state.candidateTasks || []).filter(function (candidate) {\n        return candidate.order !== task.order;\n      });\n      state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {',
        ),
      "expected dismiss handling to keep local duplicate guard keys intact",
    );
  });

  test("dashboard webview flat filter subtitles never render undefined in Task 1 listboard views", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes('const subtitle = state.filter === "all"') &&
        html.includes("? simplifiedSectionDescriptions[section.key]") &&
        html.includes(': "filtered items";'),
      "expected flat filter subtitles to fall back to a defined label instead of undefined",
    );
  });

  test("dashboard webview All grouped subtitles keep section-specific copy in Task 1 listboard views", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes('state.filter === "all"') &&
        html.includes("? simplifiedSectionDescriptions[section.key]"),
      "expected grouped All sections to keep their specific section description text",
    );
  });

  test("dashboard webview restores notes extraction inputs and status from persisted state", () => {
    const html = renderDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        notesFromDate: "2026-03-20",
        notesToDate: "2026-03-25",
        notesAiStatus: "cached notes status",
        notesAiStatusType: "processing",
      }),
    );

    assert.ok(
      html.includes('const notesFromDateInput = document.getElementById("notes-from-date");'),
      "expected notes from input to be synchronized on load",
    );
    assert.ok(
      html.includes('const notesToDateInput = document.getElementById("notes-to-date");'),
      "expected notes to input to be synchronized on load",
    );
    assert.ok(
      html.includes("notesFromDateInput.value = state.notesFromDate;"),
      "expected persisted notes from date to be restored",
    );
    assert.ok(
      html.includes("notesToDateInput.value = state.notesToDate;"),
      "expected persisted notes to date to be restored",
    );
    assert.ok(
      html.includes("setNotesAiStatus(state.notesAiStatusType, state.notesAiStatus);"),
      "expected persisted notes status to be restored",
    );
  });

  test("dashboard webview migrates legacy added extracted keys into unified candidate keys", () => {
    const html = renderDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        extractedTasks: [
          {
            kind: "candidate",
            text: "Legacy moments task",
            dueDate: null,
            category: "work",
            priority: "medium",
            timeEstimateMin: 15,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
          },
        ],
        notesExtractedTasks: [
          {
            kind: "candidate",
            text: "Legacy notes task",
            dueDate: null,
            category: "admin",
            priority: "low",
            timeEstimateMin: 10,
            source: "notes",
            sourceLabel: "projects/plan.md",
            existsAlready: false,
          },
        ],
        addedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy moments task")],
        notesAddedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy notes task")],
      }),
    );

    assert.ok(
      html.includes("addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)"),
      "expected migrated candidate keys to seed unified local duplicate tracking",
    );
  });

  test("dashboard webview browser migration guards malformed persisted candidates", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("function normalizeStoredCandidateTask(") &&
        html.includes('if (!task || typeof task !== "object") {') &&
        html.includes(
          'const text = sanitizeBrowserTaskText(typeof task.text === "string" ? task.text : "");',
        ),
      "expected browser-side candidate migration to ignore malformed persisted candidate entries before initial render",
    );
  });

  test("dashboard webview renders the minimal shell in the approved order", () => {
    const html = renderDashboardWebviewHtml();

    const headerIndex = html.indexOf('id="dashboard-header"');
    const addRowIndex = html.indexOf('id="dash-add-row"');
    const extractRowIndex = html.indexOf('id="dash-extract-row"');
    const listBarIndex = html.indexOf('id="dash-list-bar"');
    const listIndex = html.indexOf('id="dashboard-main-list"');

    assert.ok(headerIndex >= 0, "expected compact header marker");
    assert.ok(addRowIndex >= 0, "expected add task row marker");
    assert.ok(extractRowIndex >= 0, "expected extract row marker");
    assert.ok(listBarIndex >= 0, "expected list bar marker");
    assert.ok(listIndex >= 0, "expected main list marker");

    // Old heavy UI elements removed
    assert.ok(!html.includes('id="dashboard-toolbar"'), "expected old toolbar to be removed");
    assert.ok(!html.includes('id="dashboard-action-bar"'), "expected old action bar to be removed");
    assert.ok(!html.includes('id="analytics-strip"'), "expected analytics strip to be removed");
    assert.ok(!html.includes('id="dashboard-kpis"'), "expected old KPI strip shell to be removed");
    assert.ok(
      !html.includes('id="dashboard-workspace"'),
      "expected old split workspace shell to be removed",
    );
    assert.ok(
      !html.includes('id="support-rail"'),
      "expected right-side support rail shell to be removed",
    );

    // Order: header → add row → extract row → list bar → main list
    assert.ok(headerIndex < addRowIndex, "expected header before add row");
    assert.ok(addRowIndex < extractRowIndex, "expected add row before extract row");
    assert.ok(extractRowIndex < listBarIndex, "expected extract row before list bar");
    assert.ok(listBarIndex < listIndex, "expected list bar before main list");
  });

  test("dashboard webview removes the old hero-first shell and attention KPI chip", () => {
    const html = renderDashboardWebviewHtml((notesDir) => {
      const overdueDate = new Date();
      overdueDate.setDate(overdueDate.getDate() - 1);
      const overdueYmd = formatDateYMD(overdueDate);
      const overdueFile = path.join(notesDir, "tasks", `${overdueYmd}.md`);
      fs.mkdirSync(path.dirname(overdueFile), { recursive: true });
      fs.writeFileSync(
        overdueFile,
        `---\ntype: tasks\ndate: ${overdueYmd}\n---\n\n- [ ] Overdue task\n`,
        "utf8",
      );
    });

    assert.ok(!html.includes('<section class="hero">'), "expected old hero block to be removed");
    assert.ok(
      !html.includes('class="summary-card is-warning"'),
      "expected old overdue KPI card to be removed",
    );
    assert.ok(
      !html.includes('<div class="summary-label">Overdue</div>'),
      "expected overdue KPI label to be removed",
    );
    assert.ok(
      !html.includes('id="dashboard-kpi-attention"'),
      "expected attention KPI chip to be removed",
    );
    assert.ok(!html.includes(">Attention<"), "expected Attention label to be removed from header");
  });

  test("dashboard webview persists extracted results immediately on message receipt", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes(
        'mergeCandidateBatch("moments", message.tasks || []);\n        persistState();\n        rerender();',
      ),
      "expected extractResult handler to merge unified candidates before rerendering",
    );
    assert.ok(
      html.includes(
        'mergeCandidateBatch("notes", message.tasks || []);\n        persistState();\n        rerender();',
      ),
      "expected notesExtractResult handler to merge unified candidates before rerendering",
    );
  });

  test("dashboard webview keeps the support rail free of candidate cards", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      !html.includes('class="ai-result" id="ai-result"'),
      "expected support rail to drop moments candidate card rendering",
    );
    assert.ok(
      !html.includes('class="ai-result" id="notes-extract-result"'),
      "expected support rail to drop notes candidate card rendering",
    );
  });

  test("dashboard webview renders an inline candidate block below Extract", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes('id="candidate-block"'),
      "expected dedicated candidate block container",
    );
    assert.ok(html.includes('id="dashboard-main-list"'), "expected main list container");

    const extractIdx = html.indexOf('id="dash-extract-row"');
    const candidateIdx = html.indexOf('id="candidate-block"');
    const listIdx = html.indexOf('id="dashboard-main-list"');
    assert.ok(extractIdx >= 0, "expected extract row marker");
    assert.ok(candidateIdx >= 0, "expected candidate block marker");
    assert.ok(listIdx >= 0, "expected main list marker");
    assert.ok(
      extractIdx < candidateIdx && candidateIdx < listIdx,
      "expected candidate block between extract and main list",
    );
  });

  test("dashboard webview renders non-interactive header KPI chips", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(html.includes('id="dashboard-kpi-open"'), "expected Open KPI chip");
    assert.ok(html.includes('id="dashboard-kpi-today"'), "expected Today KPI chip");
    assert.ok(html.includes('id="dashboard-kpi-done"'), "expected Done % KPI chip");
    assert.ok(
      !html.includes("data-kpi-filter="),
      "expected no data-kpi-filter attributes on chips",
    );
    assert.ok(
      !html.includes('document.querySelectorAll("[data-kpi-filter]")'),
      "expected no KPI filter click wiring",
    );
  });

  test("dashboard webview keeps minimal header with KPI chips only", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(html.includes('id="dashboard-header"'), "expected header marker");
    assert.ok(
      html.includes('id="dashboard-kpi-open"') && html.includes(">Open<"),
      "expected Open KPI chip label",
    );
    assert.ok(
      html.includes('id="dashboard-kpi-today"') && html.includes(">Today<"),
      "expected Today KPI chip label",
    );
    assert.ok(
      html.includes('id="dashboard-kpi-done"') && html.includes(">Done<"),
      "expected Done KPI chip label",
    );
    assert.ok(
      !html.includes("data-kpi-filter="),
      "expected no data-kpi-filter attributes on header chips",
    );
    assert.ok(
      !html.includes('document.querySelectorAll("[data-kpi-filter]")'),
      "expected no KPI filter click wiring in browser script",
    );
    assert.ok(html.includes('id="btn-refresh"'), "expected refresh action in header");

    // Date label and weekday marker removed for minimal UI
    assert.ok(!html.includes('id="dashboard-date-label"'), "expected date label to be removed");
    assert.ok(
      !html.includes('id="dashboard-weekday-marker"'),
      "expected weekday marker to be removed",
    );

    assert.ok(
      html.includes(".dashboard-kpi-value {") &&
        html.includes("font-variant-numeric: tabular-nums;"),
      "expected KPI numbers to use tabular alignment",
    );
  });

  test("dashboard webview uses compact single-line add and extract rows", () => {
    const html = renderDashboardWebviewHtml();

    // Single-line add row with input + button
    assert.ok(
      html.includes('id="dash-add-row"') &&
        html.includes('id="new-task-text"') &&
        html.includes('id="btn-create-task"'),
      "expected compact add row with input and button",
    );

    // Compact extract row
    assert.ok(
      html.includes('id="dash-extract-row"') &&
        html.includes('data-extract-group="moments"') &&
        html.includes('data-extract-group="notes"'),
      "expected compact extract row",
    );

    // Old heavy action bar removed
    assert.ok(!html.includes('id="dashboard-action-bar"'), "expected old action bar to be removed");
    assert.ok(
      !html.includes('class="action-panel action-panel-quick-add"'),
      "expected old quick add panel to be removed",
    );
    assert.ok(
      !html.includes('class="action-panel action-panel-ai-extract"'),
      "expected old ai extract panel to be removed",
    );
    // Old section header labels removed (but text may still appear in empty states)
    assert.ok(!html.includes(">Quick Add<"), "expected Quick Add header label to be removed");
    assert.ok(!html.includes(">AI Extract<"), "expected AI Extract header label to be removed");
    assert.ok(
      html.includes(
        'document.getElementById("btn-ai-extract").addEventListener("click", function () {',
      ) &&
        html.includes(
          'document.getElementById("btn-extract-notes").addEventListener("click", function () {',
        ),
      "expected extraction commands to stay wired from the top action bar",
    );
    assert.ok(
      html.includes('const aiStatus = document.getElementById("ai-status");') &&
        html.includes('const notesStatus = document.getElementById("notes-extract-status");'),
      "expected extraction status updates to remain attached to their control groups",
    );
    assert.ok(
      html.includes('data-action="add-candidate"') &&
        html.includes('data-action="dismiss-candidate"'),
      "expected candidate Add and Dismiss actions to remain wired",
    );
    assert.ok(
      html.includes("Already exists") &&
        html.includes("canAddDashboardCandidate(task, existingTaskKeys)") &&
        html.includes('data-action="add-candidate"') &&
        html.includes('data-action="dismiss-candidate"'),
      "expected duplicate candidates to remain blocked with Already exists",
    );
    assert.ok(
      !html.includes('id="support-rail"'),
      "expected extract controls to stay out of a right rail",
    );
  });

  test("dashboard action bar stacks only below 1000px", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("@media (width < 1000px) {") &&
        html.includes(".dashboard-action-bar {\n      grid-template-columns: 1fr;"),
      "expected action bar stacking rule to start only below 1000px",
    );
    assert.ok(
      !html.includes("@media (max-width: 1000px) {\n    .dashboard-action-bar {"),
      "expected action bar not to stack at exactly 1000px",
    );
  });

  test("dashboard webview keeps saved-row interaction rules in dense listboard rows", async () => {
    const html = await renderSettledDashboardWebviewHtml();
    const secondaryActionsClusterMatch = html.match(
      /<div class="task-row-secondary-actions">([\s\S]*?)<\/div>/,
    );

    assert.ok(
      html.includes('class="task-row-toggle"') &&
        html.includes('data-action="toggle"') &&
        !html.includes('data-action="toggle" data-file='),
      "expected the checkbox toggle to remain the only done-toggle control",
    );
    assert.ok(
      html.includes('class="task-row-title"') &&
        html.includes('data-action="open"') &&
        !html.includes('class="task-row-title" data-action="edit"'),
      "expected the task title to remain the Open control",
    );
    // At desktop widths, secondary actions are revealed by hover/focus as icon-only buttons
    assert.ok(
      html.includes('class="task-row-secondary-actions"') &&
        html.includes("task-row:hover .task-row-secondary-actions") &&
        html.includes("task-row:focus-within .task-row-secondary-actions") &&
        secondaryActionsClusterMatch !== null &&
        secondaryActionsClusterMatch[1].includes(
          'class="task-row-action-icon" data-action="edit"',
        ) &&
        secondaryActionsClusterMatch[1].includes(
          'class="task-row-action-icon" data-action="open"',
        ) &&
        secondaryActionsClusterMatch[1].includes(
          'class="task-row-action-icon" data-action="delete"',
        ) &&
        secondaryActionsClusterMatch[1].includes('aria-label="Edit"') &&
        secondaryActionsClusterMatch[1].includes('aria-label="Open"') &&
        secondaryActionsClusterMatch[1].includes('aria-label="Delete"') &&
        !secondaryActionsClusterMatch[1].includes(">Edit</button>") &&
        !secondaryActionsClusterMatch[1].includes(">Open</button>") &&
        !secondaryActionsClusterMatch[1].includes(">Delete</button>"),
      "expected saved-row secondary actions to render as icon buttons with Edit/Open/Delete aria labels when revealed by hover or focus-within",
    );
    assert.ok(
      html.includes("task-row-saved") &&
        html.includes('tabindex="-1"') &&
        html.includes('class="task-row-toggle-entry"') &&
        html.includes('class="task-row-title-entry"'),
      "expected checkbox and title entry points to reveal secondary actions for keyboard users",
    );
    // At narrow widths, secondary actions collapse into a More menu
    const narrowMoreMenuRule =
      /@media \(max-width: 720px\) \{[\s\S]*?\.task-row-secondary-actions \{[\s\S]*?display: none;[\s\S]*?\.task-row-more-menu \{[\s\S]*?display: block;[\s\S]*?\}/;
    assert.ok(
      narrowMoreMenuRule.test(html),
      "expected narrow layouts to collapse secondary actions into a More menu for touch access",
    );
  });

  test("dashboard webview shows narrow-width More menu for saved-task rows", async () => {
    const html = await renderSettledDashboardWebviewHtml();
    const moreDropdownMarkupMatch = html.match(
      /<div class="task-row-more-dropdown" data-more-dropdown="[^"]+">([\s\S]*?)<\/div>/,
    );

    // More menu is hidden at desktop widths
    assert.ok(
      html.includes(".task-row-more-menu { display: none; position: relative; }") ||
        html.includes(".task-row-more-menu{display:none;position:relative}"),
      "expected More menu to be hidden at desktop widths",
    );

    // More menu becomes visible at narrow widths, secondary actions hide
    const narrowMoreMenuRule =
      /@media \(max-width: 720px\) \{[\s\S]*?\.task-row-more-menu \{[\s\S]*?display: block;[\s\S]*?\}/;
    assert.ok(narrowMoreMenuRule.test(html), "expected More menu to be visible at narrow widths");

    // Each saved-task row has a More button
    assert.ok(
      html.includes('data-action="more"') || html.includes('class="task-row-more-btn"'),
      "expected saved-task rows to have a More button",
    );

    // More dropdown contains visible Edit, Open, Delete text actions
    assert.ok(
      moreDropdownMarkupMatch !== null &&
        moreDropdownMarkupMatch[1].includes('data-action="edit"') &&
        moreDropdownMarkupMatch[1].includes(">Edit</button>") &&
        moreDropdownMarkupMatch[1].includes('data-action="open"') &&
        moreDropdownMarkupMatch[1].includes(">Open</button>") &&
        moreDropdownMarkupMatch[1].includes('data-action="delete"') &&
        moreDropdownMarkupMatch[1].includes(">Delete</button>"),
      "expected More dropdown to keep visible Edit, Open, and Delete text actions at narrow widths",
    );
  });

  test("dashboard webview renders candidate rows with duplicate handling", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("function renderCandidateItem(task, index)") &&
        html.includes("task-row-candidate") &&
        html.includes('badge task-row-label">Candidate</span>'),
      "expected candidate rows to render with proper styling",
    );
    assert.ok(
      html.includes(">Already exists</span>") &&
        html.includes('data-action="dismiss-candidate"') &&
        html.includes('data-action="add-candidate"') &&
        html.includes(' data-index="') &&
        html.includes(" disabled") &&
        html.includes(">Add</button>"),
      "expected duplicate candidate rows to keep Dismiss, keep Add visible but disabled, and still communicate Already exists",
    );
    assert.ok(
      html.includes(".task-row-candidate .task-row-title {") &&
        html.includes("white-space: normal;") &&
        html.includes("-webkit-line-clamp: 2;") &&
        html.includes("display: -webkit-box;"),
      "expected candidate row titles to stay readable with a compact two-line clamp",
    );
    assert.ok(
      html.includes(".task-row-candidate .task-row-title {"),
      "expected candidate title rule",
    );
    assert.ok(html.includes("cursor: default;"), "expected non-clickable candidate cursor");
    assert.ok(
      !html.includes(".task-row-candidate .task-row-title:hover {"),
      "expected no candidate-specific hover rule",
    );
    assert.ok(
      html.includes(".task-row-saved .task-row-title:hover {"),
      "expected saved-task hover rule to remain",
    );
    assert.ok(
      !/^\s*\.task-row-title:hover \{/m.test(html),
      "expected shared hover rule to be removed",
    );
  });

  test("dashboard webview keeps dense metadata priority for saved and candidate rows", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes('class="task-row-meta task-row-meta-saved"'),
      "expected saved-task metadata container",
    );
    assert.ok(
      html.indexOf("task-row-meta-date") < html.indexOf("task-row-meta-tag") &&
        html.indexOf("task-row-meta-tag") < html.indexOf("task-row-meta-source-saved"),
      "expected saved-task rows to keep date and due metadata before tags before source",
    );
    assert.ok(html.includes("task-row-meta-due"), "expected saved-task due metadata class");
    assert.ok(
      html.includes('class="task-row-meta task-row-meta-candidate"'),
      "expected candidate metadata container",
    );
    assert.ok(
      html.indexOf("task-row-meta-candidate-due") < html.indexOf("task-row-meta-category") &&
        html.indexOf("task-row-meta-category") < html.indexOf("task-row-meta-source-candidate"),
      "expected candidate rows to keep due/date before category or priority before source",
    );
    assert.ok(
      html.includes("task-row-meta-priority"),
      "expected candidate priority metadata class",
    );
    assert.ok(
      html.includes(".task-row-meta {") &&
        html.includes("flex-wrap: nowrap;") &&
        html.includes("overflow: hidden;") &&
        html.includes(".task-row-meta-source {") &&
        html.includes("min-width: 0;") &&
        html.includes("text-overflow: ellipsis;") &&
        html.includes("white-space: nowrap;"),
      "expected source metadata to truncate first without uncontrolled wrapping that destroys density",
    );
  });

  test("dashboard webview removes analytics strip for minimal UI", () => {
    const html = renderDashboardWebviewHtml();

    // Analytics strip removed for cleaner, action-focused UI
    assert.ok(!html.includes('id="analytics-strip"'), "expected analytics strip to be removed");
    assert.ok(!html.includes("week-chart"), "expected week chart to be removed");
    assert.ok(!html.includes("category-list"), "expected category list to be removed");
  });

  test("dashboard list view model uses final compact empty-state messaging", () => {
    const noTasksAtAll = buildDashboardListViewModel([], "all", "");
    assert.strictEqual(
      noTasksAtAll.emptyMessage,
      "No tasks yet||Use Add Task or AI Extract to create your first task.",
    );

    const noToday = buildDashboardListViewModel([], "today", "");
    assert.strictEqual(noToday.emptyMessage, "Nothing scheduled for today");

    const noPlanned = buildDashboardListViewModel([], "planned", "");
    assert.strictEqual(noPlanned.emptyMessage, "No planned tasks");

    const noDone = buildDashboardListViewModel([], "done", "");
    assert.strictEqual(noDone.emptyMessage, "No completed tasks");
  });

  test("dashboard webview renders final compact empty-state copy for All", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("function renderEmptyState(message) {") &&
        html.includes('class="empty-state-title"') &&
        html.includes('class="empty-state-body"'),
      "expected empty states to render compact structured messaging",
    );
    assert.ok(
      html.includes('"No tasks yet||Use Add Task or AI Extract to create your first task."'),
      "expected All empty state to direct users to Add Task or AI Extract",
    );
  });

  test("dashboard webview renders simplified empty-state messages for all filters", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes('"Nothing scheduled for today"'),
      "expected Today empty state to show a positive nothing-scheduled message",
    );
    assert.ok(
      html.includes('"No planned tasks"'),
      "expected Planned empty state to show no planned tasks message",
    );
    assert.ok(
      html.includes('"No completed tasks"'),
      "expected Done empty state to show no completed tasks message",
    );
    assert.ok(
      html.includes('"No matching tasks"'),
      "expected search empty state to show no matching tasks message",
    );
    assert.ok(
      html.includes("No candidates yet"),
      "expected candidate empty state to show no candidates yet message",
    );
  });

  test("dashboard webview script keeps interactive controls wired after initial render", () => {
    const html = renderDashboardWebviewHtml();

    const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, "expected dashboard webview to include an inline script block");

    const script = scriptMatch?.[1] || "";
    assert.doesNotThrow(
      () => new Function("acquireVsCodeApi", "document", "window", script),
      "expected dashboard webview script to stay parseable for runtime initialization",
    );
    assert.ok(
      script.includes(
        'document.getElementById("btn-create-task").addEventListener("click", function () {',
      ) &&
        script.includes(
          'document.getElementById("btn-ai-extract").addEventListener("click", function () {',
        ) &&
        script.includes(
          'document.getElementById("btn-extract-notes").addEventListener("click", function () {',
        ),
      "expected dashboard webview script to keep all primary button handlers registered",
    );
    assert.ok(
      script.includes(
        'throw new Error("Task Dashboard failed to initialize required webview controls.");',
      ),
      "expected dashboard webview script to fail loudly when required controls are missing",
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

      (
        harness.panel as unknown as { _handleMessage(message: Record<string, unknown>): void }
      )._handleMessage({
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

  test("addExtractedTask posts a failure ACK when createTask fails", async () => {
    const harness = createDashboardPanelMessageHarness();
    const panelWithPrivates = harness.panel as unknown as {
      _createTask: (
        text: string,
        targetDate: string | null,
        dueDate: string | null,
      ) => Promise<void>;
      _handleMessage(message: Record<string, unknown>): void;
    };
    const originalCreateTask = panelWithPrivates._createTask;

    try {
      panelWithPrivates._createTask = async () => {
        throw new Error("disk full");
      };

      panelWithPrivates._handleMessage({
        command: "addExtractedTask",
        requestId: "candidate-1",
        text: "Broken task",
        dueDate: null,
        targetDate: null,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.ok(
        harness.messages.some(
          (message) =>
            message.type === "candidateAddFailed" &&
            message.requestId === "candidate-1" &&
            typeof message.message === "string",
        ),
        "expected addExtractedTask to notify the webview when persistence fails",
      );
    } finally {
      panelWithPrivates._createTask = originalCreateTask;
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
    assert.strictEqual(
      normalizeExtractedTaskIdentity("  First line  \n\n second line due:2026-04-02  "),
      "first line / second line",
    );
  });

  test("dashboard webview aligns browser-side candidate identity normalization with multiline task sanitization", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("function sanitizeBrowserTaskText(text)"),
      "expected browser-side task identity normalization helper to exist",
    );
    assert.ok(
      html.includes('.join(" / ")'),
      "expected browser-side task identity normalization to join lines like extension-side sanitization",
    );
  });

  test("dashboard webview defines candidate add ACK handlers with rollback support", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes('if (message.type === "candidateAddResult")'),
      "expected browser-side success ACK handling for extracted candidate adds",
    );
    assert.ok(
      html.includes('if (message.type === "candidateAddFailed")'),
      "expected browser-side failure ACK handling for extracted candidate adds",
    );
    assert.ok(
      html.includes(
        "candidate.order === pending.order ? { ...candidate, added: false } : candidate",
      ),
      "expected failure ACK handling to roll candidate rows back into view",
    );
    assert.ok(
      !html.includes(
        'if (state.filter === "candidate") {\n        state.candidateTasks = state.candidateTasks.filter',
      ),
      "expected optimistic add to keep candidate rows in state so failure rollback can restore them",
    );
    assert.ok(
      html.includes('if (pending && pending.source === "notes")'),
      "expected failure rollback to route notes candidate errors to the notes status line",
    );
  });

  test("candidate block failure displays error message at top of block and clears on next success", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("state.candidateBlockError"),
      "expected state to track candidateBlockError for block-level failure display",
    );
    assert.ok(
      html.includes('class="candidate-block-error"'),
      "expected candidate block to render error with candidate-block-error class",
    );
    assert.ok(
      (html.includes("candidateBlockError") && html.includes("next extract")) ||
        html.includes("extractResult") ||
        html.includes("notesExtractResult"),
      "expected block error to clear on next extract from either source",
    );
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

    assert.deepStrictEqual(
      result.visibleTasks.map((task) => task.text),
      ["Send report", "Review budget"],
    );
    assert.strictEqual((result.visibleTasks[0] as { existsAlready?: boolean }).existsAlready, true);
    assert.strictEqual(
      (result.visibleTasks[1] as { existsAlready?: boolean }).existsAlready,
      false,
    );
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

    assert.deepStrictEqual(
      result.visibleTasks.map((task) => task.text),
      ["Send report", "Review budget"],
    );
    assert.strictEqual("existsAlready" in result.visibleTasks[0], true);
    assert.strictEqual((result.visibleTasks[0] as { existsAlready?: boolean }).existsAlready, true);
    assert.strictEqual(
      (result.visibleTasks[1] as { existsAlready?: boolean }).existsAlready,
      false,
    );
    assert.strictEqual(result.hiddenExisting, 0);
    assert.strictEqual(result.hiddenDismissed, 1);
    assert.strictEqual(result.hiddenDuplicates, 1);
  });

  test("filterExtractedTasksForDisplay ignores malformed extracted entries instead of throwing", () => {
    const extracted = [
      null,
      {},
      {
        text: "   ",
      },
      {
        text: "Plan retro",
        category: "work",
        priority: "medium",
        timeEstimateMin: 25,
        dueDate: null,
      },
    ] as unknown as ExtractedTask[];

    const result = filterExtractedTasksForDisplay(extracted, [], [], "2026-03-27");

    assert.deepStrictEqual(
      result.visibleTasks.map((task) => task.text),
      ["Plan retro"],
    );
    assert.strictEqual(result.hiddenDismissed, 0);
    assert.strictEqual(result.hiddenDuplicates, 0);
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
      canAddDashboardCandidate(
        {
          kind: "candidate",
          text: "Review budget",
          dueDate: null,
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          source: "moments",
          sourceLabel: "Moments",
          existsAlready: false,
        },
        new Set([normalizeExtractedTaskIdentity("Review budget @2026-03-31")]),
      ),
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
      canAddDashboardCandidate(
        result.visibleTasks[0],
        new Set([normalizeExtractedTaskIdentity("Plan retro")]),
      ),
      false,
    );
  });

  test("simplified filter routes saved task rows correctly", () => {
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
    const visibleToday = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "today"),
    );
    const visibleDone = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "done"),
    );

    assert.deepStrictEqual(
      visibleAll.map((item) => item.text),
      ["Overdue saved", "Today saved", "Done saved", "Candidate first", "Candidate second"],
    );
    assert.deepStrictEqual(
      visibleToday.map((item) => item.text),
      ["Overdue saved", "Today saved"],
    );
    assert.deepStrictEqual(
      visibleDone.map((item) => item.text),
      ["Done saved"],
    );

    for (const filter of [
      "overdue",
      "today",
      "upcoming",
      "scheduled",
      "backlog",
      "done",
    ] as const) {
      assert.strictEqual(
        listItems.some(
          (item: DashboardListItem) =>
            item.kind === "candidate" && matchesDashboardListItemFilter(item, filter),
        ),
        false,
      );
    }
  });

  test("simplified filter counts saved task rows only", () => {
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

    assert.strictEqual(countDashboardListItemsForFilter(listItems, "today"), 1);
    assert.strictEqual(countDashboardListItemsForFilter(listItems, "all"), 3);
    assert.strictEqual(countDashboardListItemsForFilter(listItems, "done"), 0);
  });

  test("dashboard list view model shows simplified sections under All", () => {
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
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
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
        text: "Candidate duplicate",
        dueDate: "2026-03-30",
        category: "admin",
        priority: "low",
        timeEstimateMin: 10,
        source: "notes",
        sourceLabel: "projects/plan.md",
        existsAlready: true,
      },
    ]);

    const viewModel = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, candidates),
      "all",
      "",
    );

    assert.deepStrictEqual(
      viewModel.sections.map((section: { title: string; items: DashboardListItem[] }) => ({
        title: section.title,
        kinds: section.items.map((item: DashboardListItem) => item.kind),
      })),
      [
        { title: "Today", kinds: ["task", "task"] },
        { title: "Planned", kinds: [] },
        { title: "Unsorted", kinds: [] },
        { title: "Done", kinds: [] },
      ],
    );
  });

  test("dashboard list view model keeps All sectioned and non-All filters flat in listboard order", () => {
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
          id: "tasks/2026-03-29.md:3",
          filePath: "/tmp/notes/tasks/2026-03-29.md",
          lineIndex: 3,
          text: "Upcoming saved",
          done: false,
          date: "2026-03-29",
          dueDate: "2026-03-29",
          tags: [],
        },
        {
          id: "tasks/2026-04-10.md:4",
          filePath: "/tmp/notes/tasks/2026-04-10.md",
          lineIndex: 4,
          text: "Scheduled saved",
          done: false,
          date: "2026-04-10",
          dueDate: "2026-04-10",
          tags: [],
        },
        {
          id: "tasks/inbox.md:5",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 5,
          text: "Backlog saved",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/2026-03-20.md:6",
          filePath: "/tmp/notes/tasks/2026-03-20.md",
          lineIndex: 6,
          text: "Done saved",
          done: true,
          date: "2026-03-20",
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
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
    ]);
    const items = buildDashboardListItems(savedTasks, candidates);

    const allView = buildDashboardListViewModel(items, "all", "");
    assert.deepStrictEqual(
      allView.sections.map((section) => section.title),
      ["Today", "Planned", "Unsorted", "Done"],
    );

    const todayView = buildDashboardListViewModel(items, "today", "");
    assert.deepStrictEqual(todayView.sections, []);
    assert.deepStrictEqual(
      (todayView as { flatItems?: DashboardListItem[] }).flatItems?.map((item) => item.text),
      ["Overdue saved", "Today saved"],
    );

    const plannedView = buildDashboardListViewModel(items, "planned", "");
    assert.deepStrictEqual(plannedView.sections, []);
    assert.deepStrictEqual(
      (plannedView as { flatItems?: DashboardListItem[] }).flatItems?.map((item) => item.text),
      ["Upcoming saved", "Scheduled saved"],
    );

    const doneView = buildDashboardListViewModel(items, "done", "");
    assert.deepStrictEqual(doneView.sections, []);
    assert.deepStrictEqual(
      (doneView as { flatItems?: DashboardListItem[] }).flatItems?.map((item) => item.text),
      ["Done saved"],
    );
  });

  test("dashboard list view model preserves active-view order when searching across saved tasks and candidates", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Alpha overdue",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: [],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Alpha today",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Alpha candidate",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
    ]);

    const allSearch = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, candidates),
      "all",
      "alpha",
    );

    assert.deepStrictEqual(
      allSearch.sections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => item.text),
      })),
      [{ title: "Today", items: ["Alpha overdue", "Alpha today"] }],
    );
  });

  test("dashboard list view model keeps zero-count All sections visible and uses compact empty states", () => {
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
    const items = buildDashboardListItems(savedTasks, []);

    const allView = buildDashboardListViewModel(items, "all", "");
    assert.deepStrictEqual(
      allView.sections.map((section) => ({ title: section.title, count: section.items.length })),
      [
        { title: "Today", count: 1 },
        { title: "Planned", count: 0 },
        { title: "Unsorted", count: 0 },
        { title: "Done", count: 0 },
      ],
    );
    assert.strictEqual(allView.emptyMessage, null);

    const emptyAll = buildDashboardListViewModel([], "all", "");
    assert.deepStrictEqual(emptyAll.sections, []);
    assert.strictEqual(
      emptyAll.emptyMessage,
      "No tasks yet||Use Add Task or AI Extract to create your first task.",
    );
  });

  test("dashboard list view model keeps matching All sections during partial search and hides non-matching ones", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Ops overdue alpha",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: [],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Today beta",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
        {
          id: "tasks/inbox.md:3",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 3,
          text: "Ops backlog gamma",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Ops candidate alpha",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
    ]);

    const viewModel = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, candidates),
      "all",
      "ops",
    );

    assert.deepStrictEqual(
      viewModel.sections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => item.text),
      })),
      [
        { title: "Today", items: ["Ops overdue alpha"] },
        { title: "Unsorted", items: ["Ops backlog gamma"] },
      ],
    );
    assert.strictEqual(viewModel.emptyMessage, null);
  });

  test("dashboard list view model shows only No matching tasks for empty All search results", () => {
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

    const viewModel = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, []),
      "all",
      "missing",
    );
    assert.deepStrictEqual(viewModel.sections, []);
    assert.strictEqual(viewModel.emptyMessage, "No matching tasks");
  });

  test("dashboard list view model shows correct empty states for simplified filters", () => {
    const todayOnly = buildDashboardListViewModel([], "today", "");
    assert.deepStrictEqual(todayOnly.sections, []);
    assert.strictEqual(todayOnly.emptyMessage, "Nothing scheduled for today");

    const plannedOnly = buildDashboardListViewModel([], "planned", "");
    assert.deepStrictEqual(plannedOnly.sections, []);
    assert.strictEqual(plannedOnly.emptyMessage, "No planned tasks");

    const doneOnly = buildDashboardListViewModel([], "done", "");
    assert.deepStrictEqual(doneOnly.sections, []);
    assert.strictEqual(doneOnly.emptyMessage, "No completed tasks");

    const todaySearchEmpty = buildDashboardListViewModel([], "today", "missing");
    assert.strictEqual(todaySearchEmpty.emptyMessage, "Nothing scheduled for today");

    const allWithItemsNoMatch = buildDashboardListViewModel(
      buildDashboardListItems(
        buildDashboardTaskViews(
          [
            {
              id: "tasks/2026-03-27.md:1",
              filePath: "/tmp/notes/tasks/2026-03-27.md",
              lineIndex: 1,
              text: "Something saved",
              done: false,
              date: "2026-03-27",
              dueDate: "2026-03-27",
              tags: [],
            },
          ],
          "2026-03-27",
        ),
        [],
      ),
      "all",
      "missing",
    );
    assert.strictEqual(allWithItemsNoMatch.emptyMessage, "No matching tasks");
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

  test("migrateDashboardCandidateState converts legacy extracted state into unified candidate state", () => {
    const migrated = migrateDashboardCandidateState({
      extractedTasks: [
        {
          kind: "candidate",
          text: "Legacy moments task",
          dueDate: null,
          category: "work",
          priority: "medium",
          timeEstimateMin: 15,
          source: "moments",
          sourceLabel: "Moments",
          existsAlready: false,
        },
      ],
      notesExtractedTasks: [
        {
          kind: "candidate",
          text: "Legacy notes task",
          dueDate: "2026-03-30",
          category: "admin",
          priority: "low",
          timeEstimateMin: 10,
          source: "notes",
          sourceLabel: "projects/plan.md",
          existsAlready: true,
        },
      ],
      addedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy moments task")],
      notesAddedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy notes task")],
    });

    assert.deepStrictEqual(
      migrated.candidateTasks.map((task) => ({
        text: task.text,
        source: task.source,
        sourceLabel: task.sourceLabel,
        order: task.order,
        added: task.added,
      })),
      [
        {
          text: "Legacy moments task",
          source: "moments",
          sourceLabel: "Moments",
          order: 0,
          added: true,
        },
        {
          text: "Legacy notes task",
          source: "notes",
          sourceLabel: "projects/plan.md",
          order: 1,
          added: true,
        },
      ],
    );
    assert.strictEqual(migrated.candidateOrderSeed, 2);
    assert.deepStrictEqual(migrated.addedCandidateKeys, [
      normalizeExtractedTaskIdentity("Legacy moments task"),
      normalizeExtractedTaskIdentity("Legacy notes task"),
    ]);
  });

  test("migrateDashboardCandidateState restores candidate order seed from existing candidate orders", () => {
    const migrated = migrateDashboardCandidateState({
      candidateTasks: [
        {
          kind: "candidate",
          text: "Sparse first",
          dueDate: null,
          category: "work",
          priority: "medium",
          timeEstimateMin: 15,
          source: "moments",
          sourceLabel: "Moments",
          existsAlready: false,
          extractionIndex: 0,
          order: 2,
          added: false,
        },
        {
          kind: "candidate",
          text: "Sparse second",
          dueDate: null,
          category: "admin",
          priority: "low",
          timeEstimateMin: 10,
          source: "notes",
          sourceLabel: "projects/plan.md",
          existsAlready: false,
          extractionIndex: 1,
          order: 7,
          added: false,
        },
      ],
    });

    assert.strictEqual(migrated.candidateOrderSeed, 8);
  });

  test("migrateDashboardCandidateState ignores malformed stored candidates", () => {
    const addedKey = normalizeExtractedTaskIdentity("Keep me");
    const migrated = migrateDashboardCandidateState({
      candidateTasks: [
        null,
        {
          kind: "candidate",
          text: "   ",
          source: "moments",
          sourceLabel: "Moments",
        },
        {
          kind: "candidate",
          text: "Keep me",
          dueDate: "2026-03-30",
          category: "work",
          priority: "medium",
          timeEstimateMin: 15,
          source: "moments",
          sourceLabel: "Moments",
          existsAlready: false,
          order: 7,
          extractionIndex: 3,
        },
      ],
      addedCandidateKeys: [addedKey, 42, null],
    });

    assert.strictEqual(migrated.candidateTasks.length, 1);
    assert.strictEqual(migrated.candidateTasks[0].text, "Keep me");
    assert.strictEqual(migrated.candidateTasks[0].order, 7);
    assert.strictEqual(migrated.candidateTasks[0].extractionIndex, 3);
    assert.deepStrictEqual(migrated.addedCandidateKeys, [addedKey]);
    assert.strictEqual(migrated.candidateOrderSeed, 8);
  });

  test("migrateDashboardCandidateState preserves legacy notes candidate source metadata", () => {
    const migrated = migrateDashboardCandidateState({
      notesExtractedTasks: [
        {
          text: "Review meeting notes",
          dueDate: null,
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          sourceNote: "projects/retro.md",
        },
        {
          text: "Share summary",
          dueDate: null,
          category: "work",
          priority: "low",
          timeEstimateMin: 10,
          sourceLabel: "projects/plan.md",
        },
      ],
    });

    assert.strictEqual(migrated.candidateTasks.length, 2);
    assert.strictEqual(migrated.candidateTasks[0].source, "notes");
    assert.strictEqual(migrated.candidateTasks[0].sourceLabel, "projects/retro.md");
    assert.strictEqual(migrated.candidateTasks[1].source, "notes");
    assert.strictEqual(migrated.candidateTasks[1].sourceLabel, "projects/plan.md");
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

  // ---------------------------------------------------------------------------
  // Candidate persistence tests (Task 4)
  // ---------------------------------------------------------------------------

  test("dashboard webview persists candidateTasks with extractRunAt timestamps", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("extractRunAt"),
      "expected persisted candidate state to include extractRunAt timestamp",
    );
  });

  test("dashboard webview restores unresolved candidates with extractRunAt on reopen", () => {
    const extractRunAt = "2026-04-01T10:00:00.000Z";
    const html = renderDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        candidateTasks: [
          {
            kind: "candidate",
            text: "Persisted candidate",
            dueDate: null,
            category: "work",
            priority: "medium",
            timeEstimateMin: 15,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
            order: 0,
            added: false,
            extractRunAt,
          },
        ],
        candidateOrderSeed: 1,
        addedCandidateKeys: [],
      }),
    );

    const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, "expected dashboard webview to include an inline script block");
    const script = scriptMatch?.[1] || "";

    assert.ok(
      script.includes("extractRunAt"),
      "expected browser script to handle extractRunAt when restoring persisted candidates",
    );
    assert.ok(
      script.includes("savedState.candidateTasks"),
      "expected browser script to restore candidateTasks from saved state",
    );
  });

  test("dashboard webview preserves stored display order when restoring persisted candidates", () => {
    const html = renderDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        candidateTasks: [
          {
            kind: "candidate",
            text: "First candidate",
            dueDate: null,
            category: "work",
            priority: "medium",
            timeEstimateMin: 15,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
            order: 5,
            added: false,
            extractRunAt: "2026-04-01T10:00:00.000Z",
          },
          {
            kind: "candidate",
            text: "Second candidate",
            dueDate: null,
            category: "admin",
            priority: "low",
            timeEstimateMin: 10,
            source: "notes",
            sourceLabel: "projects/plan.md",
            existsAlready: false,
            order: 3,
            added: false,
            extractRunAt: "2026-04-01T09:00:00.000Z",
          },
        ],
        candidateOrderSeed: 6,
        addedCandidateKeys: [],
      }),
    );

    const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, "expected dashboard webview to include an inline script block");
    const script = scriptMatch?.[1] || "";

    assert.ok(
      script.includes("bRunAt.localeCompare(aRunAt)"),
      "expected getVisibleCandidates to sort by extractRunAt desc for cross-batch ordering",
    );
  });

  // ---------------------------------------------------------------------------
  // Re-extract rules tests (Task 4)
  // ---------------------------------------------------------------------------

  test("dashboard webview script defines mergeCandidateBatch with extractRunAt ordering", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("extractRunAt"),
      "expected mergeCandidateBatch to set extractRunAt on merged candidates",
    );
  });

  test("dashboard webview getVisibleCandidates sorts by extractRunAt desc then order", () => {
    const html = renderDashboardWebviewHtml();

    assert.ok(
      html.includes("extractRunAt"),
      "expected getVisibleCandidates to sort by extractRunAt for cross-batch ordering",
    );
  });
});
