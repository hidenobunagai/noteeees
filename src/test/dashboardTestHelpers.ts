import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DashboardPanel } from "../dashboardPanel";

// import * as myExtension from '../../extension';

export function createMementoStub(): vscode.Memento & {
  setKeysForSync(keys: readonly string[]): void;
} {
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

export function createExtensionContextStub(): vscode.ExtensionContext {
  const context = {
    globalState: createMementoStub(),
  } satisfies Pick<vscode.ExtensionContext, "globalState">;

  return context as vscode.ExtensionContext;
}

export function createMementoStubWithValues(
  values: Record<string, unknown>,
): vscode.Memento & { setKeysForSync(keys: readonly string[]): void } {
  const memento = createMementoStub();
  for (const [key, value] of Object.entries(values)) {
    void memento.update(key, value);
  }
  return memento;
}

export function renderDashboardWebviewHtml(
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

export async function renderSettledDashboardWebviewHtml(
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

export function createDashboardPanelMessageHarness(): {
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
