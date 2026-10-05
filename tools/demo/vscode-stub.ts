// A tiny stand-in for the `vscode` API, so src/moments/*.ts and src/i18n.ts
// can run outside the extension host. Mapped to the bare specifier "vscode" by
// tools/demo/tsconfig.json (`bun --tsconfig-override=tools/demo/tsconfig.json`),
// which keeps the extension's own tsconfig and esbuild build untouched.
// Only the configuration reads those modules perform are stubbed; file IO and
// feed building are the real extension code.

const values: Record<string, unknown> = {
  // "" -> sanitizeSubfolderName falls back to "moments"
  momentsSubfolder: "",
  momentsSendOnEnter: true,
  momentsFeedDays: 7,
  momentsArchiveAfterDays: 90,
  locale: "en",
  // Demo choice: keep spaces in note filenames so `[[Wiki-link]]` titles match
  // the file stems (resolveFilename's real convert-spaces rule, set to "").
  noteTitleConvertSpaces: "",
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string) => values[key],
    update: async () => {},
    has: (key: string) => key in values,
  }),
  openTextDocument: async () => ({}),
};

export const window = {
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showTextDocument: async () => undefined,
  /** Set by tools/demo/seed.ts so BacklinksProvider sees an open note. */
  activeTextEditor: undefined as { document: { uri: { fsPath: string } } } | undefined,
};

export const env = { language: "en" };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

// --- Tree-view API surface used when src/sidebarProvider.ts and
// --- src/wikiLinks.ts run outside the extension host (seed.ts).

export class TreeItem {
  label?: string;
  collapsibleState?: number;
  contextValue?: string;
  description?: string | boolean;
  iconPath?: unknown;
  tooltip?: unknown;
  command?: unknown;
  constructor(label?: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

export class EventEmitter<T> {
  event = () => ({ dispose: () => {} });
  fire(_value?: T): void {}
  dispose(): void {}
}

export class ThemeIcon {
  constructor(readonly id: string, readonly color?: unknown) {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class MarkdownString {
  isTrusted = false;
  value = "";
  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }
}

export class Uri {
  fsPath: string;
  private constructor(fsPath: string) {
    this.fsPath = fsPath;
  }
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
}

export class Range {
  constructor(
    readonly startLine: number,
    readonly startCharacter: number,
    readonly endLine: number,
    readonly endCharacter: number,
  ) {}
}
