// Seeds a scratch notes directory with the extension's own `appendMoment()`,
// so the demo feed comes from real storage code (front matter, `- HH:MM text`
// lines, tag extraction, feed collection) instead of hand-written fixtures.
//
//   bun --tsconfig-override=tools/demo/tsconfig.json tools/demo/seed.ts   # prints the feed JSON
//
// Timestamps come from a fixed fake clock (fake-clock.ts), so reruns produce
// byte-identical files and the demo keeps saying "today" is TODAY.
import { rm } from "node:fs/promises";
import path from "node:path";
import { appendMoment, collectMomentsFeed } from "../../src/moments/fileIo.js";
import type { MomentsFeedData } from "../../src/moments/fileIo.js";
import { installFakeClock, setNow } from "./fake-clock";

export const NOTES_DIR = path.join(import.meta.dir, ".notes");
export const TODAY = "2026-10-05";
export const YESTERDAY = "2026-10-04";
/** Timestamp given to a moment captured live during the demo. */
export const CAPTURED_AT = `${TODAY}T17:06:00`;

/** [file date, capture timestamp, text] — neutral sample content, no real data. */
const ENTRIES: ReadonlyArray<readonly [string, string, string]> = [
  [YESTERDAY, `${YESTERDAY}T08:47:00`, "Sprint kickoff notes #work"],
  [YESTERDAY, `${YESTERDAY}T10:15:00`, "Changelog draft ready for review #work"],
  [YESTERDAY, `${YESTERDAY}T12:30:00`, "Idea: tag heatmap over the whole month #idea"],
  [YESTERDAY, `${YESTERDAY}T14:50:00`, "Read the VS Code webview API changelog"],
  [YESTERDAY, `${YESTERDAY}T16:10:00`, "Sidebar search feels much faster now"],
  [YESTERDAY, `${YESTERDAY}T17:25:00`, "Drafted the release checklist #work"],
  [YESTERDAY, `${YESTERDAY}T18:05:00`, "Booked the Friday demo slot #work"],
  [TODAY, `${TODAY}T11:40:00`, "Export a day of Moments as a note #idea"],
];

export async function seed(notesDir: string = NOTES_DIR): Promise<MomentsFeedData> {
  await rm(notesDir, { recursive: true, force: true });
  installFakeClock(ENTRIES[0][1]);
  for (const [date, timestamp, text] of ENTRIES) {
    setNow(timestamp);
    await appendMoment(notesDir, date, text);
  }
  setNow(CAPTURED_AT);
  return collectMomentsFeed(notesDir, TODAY);
}

if (import.meta.main) {
  console.log(JSON.stringify(await seed(), null, 2));
}
