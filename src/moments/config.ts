import {
  getMomentsFeedDaysSetting,
  getMomentsInboxFilterSetting,
  updateMomentsInboxFilterSetting,
} from "../notesConfig.js";
import { extractDueDate } from "../../shared/taskSyntax.js";
import { MOMENTS_FEED_DEFAULT_DAY_COUNT, MOMENTS_FEED_MAX_DAY_COUNT } from "../constants.js";
import { todayDateString } from "../dashboardTaskUtils.js";
import type {
  InboxTaskFilter,
  MomentDaySection,
  MomentEntry,
  PinnedEntryData,
  ResolvedPinnedEntryData,
  TaskOverviewItem,
} from "./types.js";

const MOMENTS_FEED_DAY_COUNT = MOMENTS_FEED_DEFAULT_DAY_COUNT;
export const MOMENT_TAG_PATTERN = String.raw`#[\p{L}\p{M}\p{N}_\p{Pd}]+`;

function matchMomentTags(text: string): string[] {
  return text.match(new RegExp(MOMENT_TAG_PATTERN, "gu")) ?? [];
}

function normalizeMomentTag(tag: string): string {
  return tag.normalize("NFKC").toLowerCase();
}

export function normalizeInboxTaskFilter(filter: string | undefined): InboxTaskFilter {
  if (filter === "open" || filter === "done" || filter === "all" || filter === "overdue") {
    return filter;
  }

  return "all";
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
    const today = todayDateString();
    return items.filter((item) => {
      const dueDate = extractDueDate(item.text);
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

export function normalizeMomentsFeedDayCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MOMENTS_FEED_DAY_COUNT;
  }

  return Math.min(Math.max(Math.floor(value), 1), MOMENTS_FEED_MAX_DAY_COUNT);
}

export function getMomentsFeedDayCount(): number {
  return normalizeMomentsFeedDayCount(getMomentsFeedDaysSetting());
}

export function getConfiguredInboxTaskFilter(): InboxTaskFilter {
  return normalizeInboxTaskFilter(getMomentsInboxFilterSetting());
}

export function persistInboxTaskFilter(filter: InboxTaskFilter): Thenable<void> {
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
