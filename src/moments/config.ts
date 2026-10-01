import { getMomentsFeedDaysSetting } from "../notesConfig.js";
import { MOMENTS_FEED_DEFAULT_DAY_COUNT, MOMENTS_FEED_MAX_DAY_COUNT } from "../constants.js";
import type { MomentDaySection, MomentEntry, PinnedEntryData } from "./types.js";

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
): PinnedEntryData[] {
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
    };
  });
}

/**
 * Pins are keyed by `date:index`, where index is the entry's body line. After an edit or
 * delete changes that file's line count, move later pins on the same day with their entries
 * and drop the pin of a deleted entry, so no pin silently points at a neighbour.
 */
export function shiftPinnedEntries(
  pinnedEntries: PinnedEntryData[],
  date: string,
  index: number,
  lineDelta: number,
  removed: boolean,
): PinnedEntryData[] {
  return pinnedEntries
    .filter((pinned) => !(removed && pinned.date === date && pinned.index === index))
    .map((pinned) =>
      pinned.date === date && pinned.index > index
        ? { ...pinned, index: pinned.index + lineDelta }
        : pinned,
    );
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
