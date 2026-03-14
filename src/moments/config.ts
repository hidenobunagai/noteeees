import * as vscode from "vscode";
import type { MomentEntry, TaskOverviewItem, MomentFilter, InboxTaskFilter } from "./types.js";

export const MOMENTS_FEED_DAY_COUNT = 7;
export const MOMENT_TAG_PATTERN = String.raw`#[\p{L}\p{M}\p{N}_\p{Pd}]+`;

export let lastInboxTaskFilter: InboxTaskFilter = "all";

export function setLastInboxTaskFilter(filter: InboxTaskFilter): void {
  lastInboxTaskFilter = filter;
}

function matchMomentTags(text: string): string[] {
  return text.match(new RegExp(MOMENT_TAG_PATTERN, "gu")) ?? [];
}

function normalizeMomentTag(tag: string): string {
  return tag.normalize("NFKC").toLowerCase();
}

export function normalizeInboxTaskFilter(filter: string | undefined): InboxTaskFilter {
  if (filter === "open" || filter === "done" || filter === "all") {
    return filter;
  }

  return "all";
}

export function filterMomentEntries(entries: MomentEntry[], filter: MomentFilter): MomentEntry[] {
  if (filter === "openTasks") {
    return entries.filter((entry) => entry.isTask && !entry.done);
  }

  return entries;
}

export function extractMomentTags(text: string): string[] {
  return [...new Set(matchMomentTags(text).map((tag) => normalizeMomentTag(tag)))];
}

export function filterTaskOverviewItems(
  items: TaskOverviewItem[],
  filter: InboxTaskFilter,
): TaskOverviewItem[] {
  if (filter === "open") {
    return items.filter((item) => !item.done);
  }

  if (filter === "done") {
    return items.filter((item) => item.done);
  }

  return items;
}

export function getMomentsSubfolder(): string {
  const config = vscode.workspace.getConfiguration("notes");
  return config.get<string>("momentsSubfolder") || "moments";
}

export function getSendOnEnter(): boolean {
  const config = vscode.workspace.getConfiguration("notes");
  return config.get<boolean>("momentsSendOnEnter") ?? true;
}

export function normalizeMomentsFeedDayCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MOMENTS_FEED_DAY_COUNT;
  }

  return Math.min(Math.max(Math.floor(value), 1), 30);
}

export function getMomentsFeedDayCount(): number {
  const config = vscode.workspace.getConfiguration("notes");
  return normalizeMomentsFeedDayCount(config.get<number>("momentsFeedDays"));
}

export function getConfiguredInboxTaskFilter(): InboxTaskFilter {
  const config = vscode.workspace.getConfiguration("notes");
  return normalizeInboxTaskFilter(config.get<string>("momentsInboxFilter"));
}

export function persistInboxTaskFilter(filter: InboxTaskFilter): Thenable<void> {
  lastInboxTaskFilter = filter;
  return vscode.workspace
    .getConfiguration("notes")
    .update("momentsInboxFilter", filter, vscode.ConfigurationTarget.Global);
}

export function getNextInboxFilter(filter: InboxTaskFilter): InboxTaskFilter {
  if (filter === "all") {
    return "open";
  }

  if (filter === "open") {
    return "done";
  }

  return "all";
}
