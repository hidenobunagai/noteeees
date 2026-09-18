import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  appendMoment,
  buildMomentsDateLabel,
  collectMomentsFeed,
  deleteMomentEntry,
  getMomentsFilePath,
  mapMomentBodyIndexToFileLine,
  readMoments,
  saveMomentEdit,
  searchMomentsFeed,
} from "../moments/fileIo";
import {
  extractMomentTags,
  normalizeMomentsFeedDayCount,
  resolvePinnedEntries,
} from "../moments/config";
import { MomentsViewProvider } from "../moments/panel";
import { shiftDate, todayDateString } from "../dateUtils";

function feedDates(anchor: string, dayCount: number): string[] {
  return Array.from({ length: dayCount }, (_, index) => shiftDate(anchor, -index));
}

/**
 * Every variant starts with front matter, then a blank line, so body index 1 is
 * always the first entry and its file line is always 5.
 */
const momentFileVariants: Array<{ label: string; raw: (date: string) => string }> = [
  {
    label: "LF",
    raw: (date) => `---\ntype: moments\ndate: ${date}\n---\n\n- 09:00 First\n- 09:30 Second\n`,
  },
  {
    label: "CRLF",
    raw: (date) =>
      `---\r\ntype: moments\r\ndate: ${date}\r\n---\r\n\r\n- 09:00 First\r\n- 09:30 Second\r\n`,
  },
  {
    label: "BOM",
    raw: (date) =>
      `\uFEFF---\ntype: moments\ndate: ${date}\n---\n\n- 09:00 First\n- 09:30 Second\n`,
  },
  {
    label: "divider with trailing space",
    raw: (date) => `--- \ntype: moments\ndate: ${date}\n--- \n\n- 09:00 First\n- 09:30 Second\n`,
  },
];

function createMementoStub(initialState?: Record<string, unknown>): vscode.Memento & {
  setKeysForSync(keys: readonly string[]): void;
} {
  const store = new Map<string, unknown>(initialState ? Object.entries(initialState) : undefined);

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

function createExtensionContextStub(
  initialState?: Record<string, unknown>,
): vscode.ExtensionContext {
  const context = {
    globalState: createMementoStub(initialState),
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

  const provider = new MomentsViewProvider(() => undefined, createExtensionContextStub());

  provider.resolveWebviewView(
    webviewView as vscode.WebviewView,
    {} as vscode.WebviewViewResolveContext,
    {} as vscode.CancellationToken,
  );

  return webview.html;
}

suite("Moments Core Test Suite", () => {
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
          entries: [{ index: 1, time: "09:45", text: "current text" }],
        },
      ],
    );

    assert.deepStrictEqual(resolved, [
      {
        date: "2026-03-09",
        index: 1,
        text: "current text",
        time: "09:45",
        isAvailable: true,
      },
      {
        date: "2026-03-09",
        index: 9,
        text: "orphaned pin",
        time: "12:15",
        isAvailable: false,
      },
    ]);
  });

  test("moment body index maps to file line after front matter", () => {
    for (const { label, raw } of momentFileVariants) {
      const content = raw("2026-03-07");
      const fileLine = mapMomentBodyIndexToFileLine(content, 1);

      assert.strictEqual(fileLine, 5, `${label}: expected body index 1 to map to file line 5`);
      assert.ok(
        (content.split("\n")[fileLine] ?? "").startsWith("- 09:00 First"),
        `${label}: expected the mapped file line to hold the entry`,
      );
    }
  });

  test("read index and file line round-trip across front matter variants", async () => {
    const date = "2026-03-07";

    for (const { label, raw } of momentFileVariants) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
      const filePath = getMomentsFilePath(tmpDir, date);

      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, raw(date), "utf8");

        const entries = await readMoments(tmpDir, date);
        assert.deepStrictEqual(
          entries.map((entry) => `${entry.time} ${entry.text}`),
          ["09:00 First", "09:30 Second"],
          `${label}: expected both entries to be read without front matter`,
        );

        const fileLines = fs.readFileSync(filePath, "utf8").split("\n");
        for (const entry of entries) {
          const fileLine = mapMomentBodyIndexToFileLine(
            fs.readFileSync(filePath, "utf8"),
            entry.index,
          );
          assert.ok(
            (fileLines[fileLine] ?? "").startsWith(`- ${entry.time} ${entry.text}`),
            `${label}: body index ${entry.index} should map to its own file line`,
          );
        }

        assert.strictEqual(
          await saveMomentEdit(tmpDir, date, entries[0].index, "Edited first"),
          true,
          `${label}: expected the edit to be written`,
        );
        assert.strictEqual(
          await deleteMomentEntry(tmpDir, date, entries[1].index),
          true,
          `${label}: expected the deletion to be written`,
        );

        const remaining = await readMoments(tmpDir, date);
        assert.deepStrictEqual(
          remaining.map((entry) => entry.text),
          ["Edited first"],
          `${label}: expected only the edited entry to survive`,
        );

        const saved = fs.readFileSync(filePath, "utf8");
        assert.ok(
          saved.includes("type: moments"),
          `${label}: expected front matter to be preserved`,
        );
        assert.strictEqual(
          saved.includes("\r\n"),
          raw(date).includes("\r\n"),
          `${label}: expected the file to keep its line endings`,
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  test("moments date label only prefixes today", () => {
    assert.strictEqual(buildMomentsDateLabel("2026-03-09", "2026-03-09"), "Today · 2026-03-09");
    assert.strictEqual(buildMomentsDateLabel("2026-03-08", "2026-03-09"), "2026-03-08");
  });

  test("moments feed dates stack backward from the anchor date", () => {
    assert.deepStrictEqual(feedDates("2026-03-09", 4), [
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
        `---\ntype: moments\ndate: ${date}\n---\n\n- 09:00 First line\nSecond line\n- 09:30 Next entry\n`,
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
          tags: [],
        },
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("invalid Moments dates never resolve a file path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    try {
      for (const date of ["../../x", "2026-1-1", ""]) {
        assert.throws(() => getMomentsFilePath(tmpDir, date), /Invalid Moments date/);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("invalid Moments dates are rejected without writing or deleting files", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    const notesDir = path.join(tmpRoot, "notes");
    const validDate = "2026-03-07";
    const validFilePath = path.join(notesDir, "moments", `${validDate}.md`);

    try {
      await appendMoment(notesDir, validDate, "keep me");

      for (const date of ["../../x", "2026-1-1", ""]) {
        await assert.rejects(() => saveMomentEdit(notesDir, date, 1, "pwned"));
        await assert.rejects(() => deleteMomentEntry(notesDir, date, 1));
      }

      // `../../x` would escape to <tmpRoot>/x.md if the date were trusted
      assert.strictEqual(fs.existsSync(path.join(tmpRoot, "x.md")), false);
      assert.strictEqual(fs.existsSync(path.join(notesDir, "moments", "2026-1-1.md")), false);
      assert.strictEqual(fs.existsSync(path.join(notesDir, "moments", ".md")), false);

      const kept = fs.readFileSync(validFilePath, "utf8");
      assert.ok(kept.includes("keep me"), "expected the existing moment to survive");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("moments feed can load older visible days incrementally", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    const today = todayDateString();
    const [todayDate, yesterdayDate, twoDaysAgoDate, threeDaysAgoDate] = feedDates(today, 4);

    try {
      await appendMoment(tmpDir, todayDate, "Today entry");
      fs.writeFileSync(
        getMomentsFilePath(tmpDir, yesterdayDate),
        `---\ntype: moments\ndate: ${yesterdayDate}\n---\n\n`,
        "utf8",
      );
      fs.writeFileSync(
        getMomentsFilePath(tmpDir, twoDaysAgoDate),
        `---\ntype: moments\ndate: ${twoDaysAgoDate}\n---\n\n- 09:00 Two days ago\n`,
        "utf8",
      );
      fs.writeFileSync(
        getMomentsFilePath(tmpDir, threeDaysAgoDate),
        `---\ntype: moments\ndate: ${threeDaysAgoDate}\n---\n\n- 08:00 Three days ago\n`,
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

  test("moment body index maps correctly without front matter", () => {
    const raw = "- 09:00 first\n- 10:00 second";
    assert.strictEqual(mapMomentBodyIndexToFileLine(raw, 0), 0);
    assert.strictEqual(mapMomentBodyIndexToFileLine(raw, 1), 1);
  });

  test("legacy checkbox entries stay readable and are rewritten as plain lines", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    const date = "2026-03-07";
    const filePath = getMomentsFilePath(tmpDir, date);

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        `---\ntype: moments\ndate: ${date}\n---\n\n- [ ] 09:00 First line\n- [x] 09:30 Done line\n`,
        "utf8",
      );

      const entries = await readMoments(tmpDir, date);
      assert.deepStrictEqual(
        entries.map((entry) => entry.text),
        ["First line", "Done line"],
      );

      assert.strictEqual(await saveMomentEdit(tmpDir, date, 1, "Still first"), true);
      const saved = fs.readFileSync(filePath, "utf8");
      assert.strictEqual(saved.includes("- [ ]"), false);
      assert.ok(saved.includes("- 09:00 Still first"));
      assert.ok(saved.includes("- [x] 09:30 Done line"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("normalizeMomentsFeedDayCount clamps edge cases including NaN and Infinity", () => {
    assert.strictEqual(normalizeMomentsFeedDayCount(NaN), 7);
    assert.strictEqual(normalizeMomentsFeedDayCount(Infinity), 7);
    assert.strictEqual(normalizeMomentsFeedDayCount(-5), 1);
    assert.strictEqual(normalizeMomentsFeedDayCount(1), 1);
    assert.strictEqual(normalizeMomentsFeedDayCount(30), 30);
  });

  test("searchMomentsFeed matches across all dates newest first", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    try {
      await appendMoment(tmpDir, "2026-03-05", "alpha note");
      await appendMoment(tmpDir, "2026-03-06", "beta note");
      await appendMoment(tmpDir, "2026-03-07", "ALPHA uppercase");

      const matches = await searchMomentsFeed(tmpDir, "alpha");
      assert.deepStrictEqual(
        matches.sections.map((s) => s.date),
        ["2026-03-07", "2026-03-05"],
      );
      assert.strictEqual(matches.sections[0].entries.length, 1);
      assert.strictEqual(matches.sections[0].entries[0].text, "ALPHA uppercase");

      const none = await searchMomentsFeed(tmpDir, "gamma");
      assert.strictEqual(none.sections.length, 0);
      assert.strictEqual(none.hasMoreOlder, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("searchMomentsFeed returns empty sections for blank query", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    try {
      await appendMoment(tmpDir, "2026-03-07", "hello world");
      const result = await searchMomentsFeed(tmpDir, "   ");
      assert.deepStrictEqual(result.sections, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Moments search keeps pinned entries", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-moments-"));
    try {
      const date = "2026-03-07";
      const text = "alpha pin target";
      await appendMoment(tmpDir, date, text);
      const [liveEntry] = await readMoments(tmpDir, date);
      assert.ok(liveEntry);

      let messageListener: ((message: unknown) => Promise<unknown> | unknown) | undefined;
      const postedMessages: Array<Record<string, unknown>> = [];

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
        onDidReceiveMessage<T>(listener: (e: T) => unknown): vscode.Disposable {
          messageListener = listener as (message: unknown) => Promise<unknown> | unknown;
          return new vscode.Disposable(() => undefined);
        },
        postMessage(message: unknown): Thenable<boolean> {
          postedMessages.push(message as Record<string, unknown>);
          return Promise.resolve(true);
        },
      };

      const viewStub = {
        webview,
        show(_preserveFocus?: boolean): void {
          return;
        },
      } as unknown as vscode.WebviewView;

      const context = createExtensionContextStub({
        "moments.pinnedEntries": [
          {
            date,
            index: 1,
            text: "stale text",
            time: "00:00",
          },
        ],
      });

      const provider = new MomentsViewProvider(() => tmpDir, context);
      provider.resolveWebviewView(
        viewStub,
        {} as vscode.WebviewViewResolveContext,
        {} as vscode.CancellationToken,
      );

      assert.ok(messageListener);
      await messageListener({ command: "searchMoments", query: "alpha" });

      assert.ok(postedMessages.length > 0);
      const lastMessage = postedMessages[postedMessages.length - 1] as {
        command: string;
        sections: unknown[];
        pinnedEntries: unknown[];
      };
      assert.strictEqual(lastMessage.command, "update");
      assert.ok(Array.isArray(lastMessage.sections) && lastMessage.sections.length > 0);
      assert.ok(lastMessage.pinnedEntries.length > 0);
      assert.deepStrictEqual(lastMessage.pinnedEntries, [
        {
          date,
          index: 1,
          text,
          time: liveEntry.time,
          isAvailable: true,
        },
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
