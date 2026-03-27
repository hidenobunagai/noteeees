import * as vscode from "vscode";
import { DashboardPanel } from "./dashboardPanel.js";

// ---------------------------------------------------------------------------
// Debounced file-change handler that refreshes the Dashboard
// ---------------------------------------------------------------------------

let debounceTimer: NodeJS.Timeout | undefined;

function scheduleRefresh(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    DashboardPanel.refresh();
  }, 500);
}

export function createTaskFileWatcher(
  notesDir: string,
  context: vscode.ExtensionContext,
): vscode.Disposable {
  // Watch for changes to any .md file outside the moments subfolder
  // Using a broad pattern and filtering in the handler
  const momentsSubfolder =
    vscode.workspace.getConfiguration("notes").get<string>("momentsSubfolder") || "moments";

  const pattern = new vscode.RelativePattern(notesDir, "**/*.md");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const shouldSkip = (uri: vscode.Uri): boolean => {
    // Skip if inside the moments subfolder
    return (
      uri.fsPath.includes(`/${momentsSubfolder}/`) || uri.fsPath.includes(`\\${momentsSubfolder}\\`)
    );
  };

  const onChange = (uri: vscode.Uri): void => {
    if (!shouldSkip(uri)) {
      scheduleRefresh();
    }
  };

  watcher.onDidCreate(onChange, null, context.subscriptions);
  watcher.onDidChange(onChange, null, context.subscriptions);
  watcher.onDidDelete(onChange, null, context.subscriptions);

  return watcher;
}
