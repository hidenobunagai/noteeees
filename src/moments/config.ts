import { getMomentsFeedDaysSetting } from "../notesConfig.js";
import { MOMENTS_FEED_DEFAULT_DAY_COUNT, MOMENTS_FEED_MAX_DAY_COUNT } from "../constants.js";
import type {
  MomentDaySection,
  MomentEntry,
  PinnedEntryData,
  ResolvedPinnedEntryData,
} from "./types.js";

const MOMENTS_FEED_DAY_COUNT = MOMENTS_FEED_DEFAULT_DAY_COUNT;
export const MOMENT_TAG_PATTERN = String.raw`#[\p{L}\p{M}\p{N}_\p{Pd}]+`;

function matchMomentTags(text: string): string[] {
  return text.match(new RegExp(MOMENT_TAG_PATTERN, "gu")) ?? [];
}

function normalizeMomentTag(tag: string): string {
  return tag.normalize("NFKC").toLowerCase();
}

export function extractMomentTags(text: string): string[] {
  return [...new Set(matchMomentTags(text).map((tag) => normalizeMomentTag(tag)))];
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
