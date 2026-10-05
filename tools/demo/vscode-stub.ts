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
};

export const env = { language: "en" };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
