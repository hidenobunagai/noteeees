import { describe, expect, test } from "bun:test";
import { noteMatchesDateRange } from "../src/search.js";

describe("get_notes_by_date", () => {
  test("noteMatchesDateRange filters by date range", () => {
    const entry = {
      filename: "2026-03-28_note.md",
      title: "Test Note",
      tags: [],
      createdAt: "2026-03-28",
      mtime: 0,
      content: "",
      filePath: "/notes/2026-03-28_note.md",
    };

    // Within range
    expect(noteMatchesDateRange(entry, "2026-03-26", "2026-03-28")).toBe(true);
    expect(noteMatchesDateRange(entry, "2026-03-28", "2026-03-30")).toBe(true);
    expect(noteMatchesDateRange(entry, "2026-03-28", "2026-03-28")).toBe(true);

    // Outside range
    expect(noteMatchesDateRange(entry, "2026-03-29", "2026-03-30")).toBe(false);
    expect(noteMatchesDateRange(entry, "2026-03-20", "2026-03-27")).toBe(false);
  });

  test("noteMatchesDateRange handles filename without date", () => {
    const entry = {
      filename: "inbox.md",
      title: "Inbox",
      tags: [],
      createdAt: null,
      mtime: 0,
      content: "",
      filePath: "/notes/inbox.md",
    };

    expect(noteMatchesDateRange(entry, "2026-03-26", "2026-03-28")).toBe(false);
  });

  test("noteMatchesDateRange with open ended range", () => {
    const entry = {
      filename: "2026-03-28_note.md",
      title: "Test Note",
      tags: [],
      createdAt: "2026-03-28",
      mtime: 0,
      content: "",
      filePath: "/notes/2026-03-28_note.md",
    };

    // Only from date
    expect(noteMatchesDateRange(entry, "2026-03-28", undefined)).toBe(true);
    expect(noteMatchesDateRange(entry, "2026-03-29", undefined)).toBe(false);

    // Only to date
    expect(noteMatchesDateRange(entry, undefined, "2026-03-28")).toBe(true);
    expect(noteMatchesDateRange(entry, undefined, "2026-03-27")).toBe(false);
  });
});
