import * as assert from "assert";
import * as vscode from "vscode";
import { MomentsViewProvider } from "../moments/panel";
import { extractDueDate, stripDueDateTokens } from "../taskSyntax";
import {
  createExtensionContextStub,
  renderSettledDashboardWebviewHtml,
} from "./dashboardTestHelpers";

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

suite("Task Syntax Test Suite", () => {
  test("shared due date syntax extracts and strips every supported token", () => {
    assert.strictEqual(extractDueDate("Fix bug 📅2026-04-01"), "2026-04-01");
    assert.strictEqual(extractDueDate("Review spec due:2026-04-02"), "2026-04-02");
    assert.strictEqual(extractDueDate("Triage #due:2026-04-03"), "2026-04-03");
    assert.strictEqual(extractDueDate("Meet @2026-04-04"), "2026-04-04");

    assert.strictEqual(stripDueDateTokens("Fix bug 📅2026-04-01"), "Fix bug");
    assert.strictEqual(stripDueDateTokens("Review spec due:2026-04-02"), "Review spec");
    assert.strictEqual(stripDueDateTokens("Triage #due:2026-04-03"), "Triage");
    assert.strictEqual(stripDueDateTokens("Meet @2026-04-04"), "Meet");
  });

  test("dashboard webview browser normalization supports #due tokens", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes(
        'const browserDueTokenPattern = new RegExp("^(?:📅|#?due:|@)(\\\\d{4}-\\\\d{2}-\\\\d{2})$", "i");',
      ),
      "expected browser-side candidate normalization to share the full due token syntax including #due:",
    );
  });

  test("moments webview due badge parser supports shared due date syntax", () => {
    const html = renderMomentsWebviewHtml();

    assert.ok(
      html.includes(
        'entry.text.match(new RegExp("(?:📅|#?due:|@)(\\\\d{4}-\\\\d{2}-\\\\d{2})", "i"))',
      ),
      "expected moments webview due badge parsing to support 📅, due:, #due:, and @ tokens",
    );
  });
});
