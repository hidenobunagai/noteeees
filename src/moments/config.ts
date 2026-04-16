import type {
  MomentDaySection,
  MomentEntry,
  TaskOverviewItem,
  MomentFilter,
  InboxTaskFilter,
  PinnedEntryData,
  ResolvedPinnedEntryData,
} from "./types.js";
import {
  getMomentsFeedDaysSetting,
  getMomentsInboxFilterSetting,
  getMomentsSendOnEnterSetting,
  getMomentsSubfolderSetting,
  updateMomentsInboxFilterSetting,
} from "../notesConfig.js";
import { parseDueDate } from "./dueDates.js";

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

function getTodayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function normalizeInboxTaskFilter(filter: string | undefined): InboxTaskFilter {
  if (filter === "open" || filter === "done" || filter === "all" || filter === "overdue") {
    return filter;
  }

  return "all";
}

export function filterMomentEntries(entries: MomentEntry[], filter: MomentFilter): MomentEntry[] {
  if (filter === "open") {
    return entries.filter((entry) => !entry.done);
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

  if (filter === "overdue") {
    const today = getTodayDateString();
    return items.filter((item) => {
      const dueDate = parseDueDate(item.text);
      return dueDate !== null && dueDate < today && !item.done;
    });
  }

  return items;
}

export function resolvePinnedEntries(
  pinnedEntries: PinnedEntryData[],
  sections: MomentDaySection[],
): ResolvedPinnedEntryData[] {
  const liveEntries = new Map<string, MomentEntry>();

  for (const section of sections) {
    for (const entry of section.entries) {
      liveEntries.set(`${section.date}:${entry.index}`, entry);
    }
  }

  return pinnedEntries.map((pinned) => {
    const liveEntry = liveEntries.get(`${pinned.date}:${pinned.index}`);

    return {
      ...pinned,
      text: liveEntry?.text ?? pinned.text,
      time: liveEntry?.time ?? pinned.time,
      done: liveEntry?.done ?? false,
      isAvailable: liveEntry !== undefined,
    };
  });
}

export function getMomentsSubfolder(): string {
  return getMomentsSubfolderSetting();
}

export function getSendOnEnter(): boolean {
  return getMomentsSendOnEnterSetting();
}

export function normalizeMomentsFeedDayCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MOMENTS_FEED_DAY_COUNT;
  }

  return Math.min(Math.max(Math.floor(value), 1), 30);
}

export function getMomentsFeedDayCount(): number {
  return normalizeMomentsFeedDayCount(getMomentsFeedDaysSetting());
}

export function getConfiguredInboxTaskFilter(): InboxTaskFilter {
  return normalizeInboxTaskFilter(getMomentsInboxFilterSetting());
}

export function persistInboxTaskFilter(filter: InboxTaskFilter): Thenable<void> {
  lastInboxTaskFilter = filter;
  return updateMomentsInboxFilterSetting(filter);
}

export function getNextInboxFilter(filter: InboxTaskFilter): InboxTaskFilter {
  if (filter === "all") {
    return "open";
  }

  if (filter === "open") {
    return "done";
  }

  if (filter === "done") {
    return "overdue";
  }

  return "all";
}
