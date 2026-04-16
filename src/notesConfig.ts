import * as vscode from "vscode";

export interface NotesDefaultSnippetSetting {
  langId?: string;
  name?: string | null;
}

export type NotesSidebarTagSortMode = "frequency" | "alphabetical";
export type NotesConfigKey =
  | "notesDirectory"
  | "defaultNoteTitle"
  | "noteTitleConvertSpaces"
  | "defaultSnippet"
  | "templates"
  | "sidebarRecentLimit"
  | "sidebarTagSort"
  | "momentsSubfolder"
  | "momentsSendOnEnter"
  | "momentsFeedDays"
  | "momentsInboxFilter"
  | "momentsArchiveAfterDays"
  | "dailyNoteTemplate"
  | "workspaceNotesDirectory";

function getNotesConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("notes");
}

export function affectsNotesConfiguration(
  event: vscode.ConfigurationChangeEvent,
  key: NotesConfigKey,
): boolean {
  return event.affectsConfiguration(`notes.${key}`);
}

export function getLegacyNotesDirectorySetting(): string | undefined {
  return getNotesConfiguration().get<string>("notesDirectory") || undefined;
}

export function updateLegacyNotesDirectorySetting(
  value: string | undefined,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Thenable<void> {
  return getNotesConfiguration().update("notesDirectory", value, target);
}

export function getWorkspaceNotesDirectorySetting(): string | undefined {
  return getNotesConfiguration().get<string>("workspaceNotesDirectory") || undefined;
}

export function updateWorkspaceNotesDirectorySetting(
  value: string | undefined,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
): Thenable<void> {
  return getNotesConfiguration().update("workspaceNotesDirectory", value, target);
}

export function getDefaultNoteTitleSetting(): string {
  return getNotesConfiguration().get<string>("defaultNoteTitle") || "{dt}_{title}.{ext}";
}

export function getNoteTitleConvertSpacesSetting(): string {
  return getNotesConfiguration().get<string>("noteTitleConvertSpaces") ?? "_";
}

export function getDefaultSnippetSetting(): NotesDefaultSnippetSetting | undefined {
  return getNotesConfiguration().get<NotesDefaultSnippetSetting>("defaultSnippet");
}

export function getTemplatesSetting(): string[] {
  return getNotesConfiguration().get<string[]>("templates") || [];
}

export function getSidebarRecentLimitSetting(): number {
  return Math.max(0, getNotesConfiguration().get<number>("sidebarRecentLimit") ?? 20);
}

export function getSidebarTagSortSetting(): NotesSidebarTagSortMode {
  return getNotesConfiguration().get<NotesSidebarTagSortMode>("sidebarTagSort") ?? "frequency";
}

export function updateSidebarTagSortSetting(
  value: NotesSidebarTagSortMode,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Thenable<void> {
  return getNotesConfiguration().update("sidebarTagSort", value, target);
}

export function getMomentsSubfolderSetting(): string {
  return getNotesConfiguration().get<string>("momentsSubfolder") || "moments";
}

export function getMomentsSendOnEnterSetting(): boolean {
  return getNotesConfiguration().get<boolean>("momentsSendOnEnter") ?? true;
}

export function getMomentsFeedDaysSetting(): number | undefined {
  return getNotesConfiguration().get<number>("momentsFeedDays");
}

export function getMomentsInboxFilterSetting(): string | undefined {
  return getNotesConfiguration().get<string>("momentsInboxFilter");
}

export function updateMomentsInboxFilterSetting(
  value: string,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Thenable<void> {
  return getNotesConfiguration().update("momentsInboxFilter", value, target);
}

export function getMomentsArchiveAfterDaysSetting(): number {
  return Math.max(1, getNotesConfiguration().get<number>("momentsArchiveAfterDays") ?? 90);
}

export function getDailyNoteTemplateSetting(): string | undefined {
  return getNotesConfiguration().get<string>("dailyNoteTemplate") || undefined;
}
