// Serves the real Moments webview for screenshot capture.
//
//   bun --tsconfig-override=tools/demo/tsconfig.json tools/demo/harness.ts
//   -> prints `HARNESS http://127.0.0.1:<port>` and serves until killed.
//
// The page is exactly what MomentsPanel._getHtml() emits: the panel template is
// extracted from src/moments/panel.ts at runtime (so it can't drift), styled by
// webview/moments-style.css, driven by webview/moments-script.js with the real
// tag pattern, plus the real English i18n script. Two deliberate differences:
// the CSP meta tag is dropped (assets load over http://localhost) and
// `acquireVsCodeApi` is stubbed to POST messages here, where handleMessage()
// mirrors the extension's switch in panel.ts and answers with a real
// `collectMomentsFeed()` payload. Theme: VS Code Dark Modern.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MOMENT_TAG_PATTERN,
  getMomentsFeedDayCount,
  resolvePinnedEntries,
} from "../../src/moments/config.js";
import {
  appendMoment,
  collectMomentsFeed,
  isValidMomentDate,
  searchMomentsFeed,
} from "../../src/moments/fileIo.js";
import type { MomentsFeedData } from "../../src/moments/fileIo.js";
import { buildWebviewI18nScript, resolveLocale, t } from "../../src/i18n.js";
import { formatDateString } from "../../src/dateUtils.js";
import { getMomentsSendOnEnterSetting } from "../../src/notesConfig.js";
import { NOTES_DIR, seed } from "./seed";

const ROOT = path.join(import.meta.dir, "..", "..");

// VS Code Dark Modern token values (extensions/theme-defaults/themes/dark_modern.json)
const THEME_STYLE = `<style>
:root {
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
  --vscode-font-size: 13px;
  --vscode-foreground: #cccccc;
  --vscode-descriptionForeground: #9d9d9d;
  --vscode-errorForeground: #f85149;
  --vscode-focusBorder: #0078d4;
  --vscode-textLink-foreground: #4daafc;
  --vscode-sideBar-background: #181818;
  --vscode-editor-background: #1f1f1f;
  --vscode-editorWidget-background: #202020;
  --vscode-panel-border: #2b2b2b;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-toolbar-hoverBackground: #2a2d2e;
  --vscode-toolbar-activeBackground: #3c3c3c;
  --vscode-input-background: #313131;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #3c3c3c;
  --vscode-input-placeholderForeground: #989898;
  --vscode-inputValidation-errorBackground: #5a1d1d;
  --vscode-inputValidation-errorBorder: #be1100;
  --vscode-inputValidation-errorForeground: #ffffff;
  --vscode-button-background: #0078d4;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #026ec1;
  --vscode-button-secondaryBackground: #3a3d41;
  --vscode-button-secondaryForeground: #cccccc;
  --vscode-button-secondaryHoverBackground: #2b2b2b;
}
html, body { background: var(--vscode-sideBar-background); }
</style>`;

// Stands in for the VS Code webview bridge: POST every message to the harness,
// which replies with the same payload postMessage() would deliver.
const BRIDGE_SCRIPT = `<script>
window.acquireVsCodeApi = function () {
  return {
    postMessage(message) {
      fetch("/api/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      })
        .then((response) => response.json())
        .then((payload) => {
          if (payload) window.dispatchEvent(new MessageEvent("message", { data: payload }));
        });
    },
    getState: function () { return {}; },
    setState: function () {},
  };
};
</script>`;

function readWebview(name: string): string {
  return readFileSync(path.join(ROOT, "webview", name), "utf8");
}

/** The HTML template literal inside MomentsPanel._getHtml(), extracted verbatim. */
function panelTemplate(): string {
  const source = readFileSync(path.join(ROOT, "src", "moments", "panel.ts"), "utf8");
  const marker = "return /* html */ `";
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error("could not find the HTML template in src/moments/panel.ts");
  }
  const from = start + marker.length;
  const end = source.indexOf("`", from);
  if (end < 0 || source[end + 1] !== ";") {
    throw new Error("unterminated HTML template in src/moments/panel.ts");
  }
  return source.slice(from, end);
}

function buildHtml(): string {
  const script = readWebview("moments-script.js").replace(
    "__MOMENT_TAG_PATTERN__",
    JSON.stringify(MOMENT_TAG_PATTERN),
  );
  const render = new Function(
    "nonce",
    "resolveLocale",
    "momentsStyle",
    "i18nScript",
    "script",
    `return \`${panelTemplate()}\`;`,
  );
  const html = render(
    "demo-nonce",
    resolveLocale,
    readWebview("moments-style.css"),
    buildWebviewI18nScript(),
    script,
  ) as string;
  return html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, "")
    .replace("</head>", `${THEME_STYLE}${BRIDGE_SCRIPT}</head>`);
}

// ---------------------------------------------------------------------------
// Message handling — mirrors MomentsViewProvider.onDidReceiveMessage in panel.ts
// ---------------------------------------------------------------------------

let anchorDate = formatDateString(new Date());
let feedSectionCount = getMomentsFeedDayCount();

async function updatePayload(feed: MomentsFeedData, hasMoreOlder: boolean): Promise<object> {
  return {
    command: "update",
    sections: feed.sections,
    sendOnEnter: getMomentsSendOnEnterSetting(),
    todayDate: formatDateString(new Date()),
    anchorDate,
    locale: resolveLocale(),
    pinnedEntries: resolvePinnedEntries([], feed.sections),
    hasMoreOlder,
  };
}

async function sendEntries(): Promise<object> {
  const feed = await collectMomentsFeed(NOTES_DIR, anchorDate, feedSectionCount);
  return updatePayload(feed, feed.hasMoreOlder);
}

async function handleMessage(message: Record<string, unknown>): Promise<object | null> {
  switch (message.command) {
    case "ready":
    case "refreshFeed":
      feedSectionCount = Math.max(feedSectionCount, getMomentsFeedDayCount());
      return sendEntries();

    case "loadMore":
      feedSectionCount += Math.max(1, getMomentsFeedDayCount());
      return sendEntries();

    case "jumpToDate":
      if (isValidMomentDate(message.date)) {
        anchorDate = message.date;
        feedSectionCount = Math.max(1, getMomentsFeedDayCount());
      }
      return sendEntries();

    case "jumpToToday":
      anchorDate = formatDateString(new Date());
      feedSectionCount = Math.max(1, getMomentsFeedDayCount());
      return sendEntries();

    case "searchMoments": {
      const query = typeof message.query === "string" ? message.query : "";
      const feed = await searchMomentsFeed(NOTES_DIR, query);
      return updatePayload(feed, false);
    }

    case "addMoment": {
      if (typeof message.text !== "string" || !message.text.trim()) {
        return { command: "error", message: t("momentTextEmpty") };
      }
      await appendMoment(NOTES_DIR, formatDateString(new Date()), message.text);
      // Jump back to today so the new entry is visible.
      anchorDate = formatDateString(new Date());
      feedSectionCount = Math.max(feedSectionCount, getMomentsFeedDayCount());
      return sendEntries();
    }

    default:
      return null;
  }
}

export function startHarness(port = 0): ReturnType<typeof Bun.serve> {
  const html = buildHtml();
  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/message" && request.method === "POST") {
        const message = (await request.json()) as Record<string, unknown>;
        return Response.json(await handleMessage(message));
      }
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
}

if (import.meta.main) {
  await seed(); // installs the fixed clock; "today" is TODAY from here on
  const server = startHarness();
  console.log(`HARNESS http://127.0.0.1:${server.port}`);
}
