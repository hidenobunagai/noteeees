import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getMomentsArchiveAfterDaysSetting } from "../notesConfig.js";
import {
  extractMomentTags,
  getMomentsFeedDayCount,
  getMomentsSubfolder,
  MOMENTS_FEED_DAY_COUNT,
  normalizeMomentsFeedDayCount,
} from "./config.js";
import type { MomentDaySection, MomentEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function offsetDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

export function getMomentsFilePath(notesDir: string, date: string): string {
  const subfolder = getMomentsSubfolder();
  return path.join(notesDir, subfolder, `${date}.md`);
}

export function getMomentsDirectory(notesDir: string): string {
  return path.join(notesDir, getMomentsSubfolder());
}

async function listMomentFileDates(notesDir: string): Promise<string[]> {
  const momentsDir = getMomentsDirectory(notesDir);
  try {
    await fs.access(momentsDir);
  } catch {
    return [];
  }

  const dateFilePattern = /^(\d{4}-\d{2}-\d{2})\.md$/;
  const entries = await fs.readdir(momentsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(dateFilePattern)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => b.localeCompare(a));
}

function parseMomentEntryStart(line: string): { time: string; text: string; done: boolean } | null {
  const taskDone = line.match(/^-\s+\[x\]\s+(\d{2}:\d{2})\s+(.*)/i);
  if (taskDone) {
    return {
      time: taskDone[1],
      text: taskDone[2],
      done: true,
    };
  }

  const taskTodo = line.match(/^-\s+\[ \]\s+(\d{2}:\d{2})\s+(.*)/i);
  if (taskTodo) {
    return {
      time: taskTodo[1],
      text: taskTodo[2],
      done: false,
    };
  }

  const regular = line.match(/^-\s+(\d{2}:\d{2})\s+(.*)/);
  if (regular) {
    return {
      time: regular[1],
      text: regular[2],
      done: false,
    };
  }

  return null;
}

function findMomentEntryRange(
  lines: string[],
  startIndex: number,
): { startIndex: number; endIndex: number } | null {
  if (startIndex < 0 || startIndex >= lines.length) {
    return null;
  }

  if (!parseMomentEntryStart(lines[startIndex])) {
    return null;
  }

  let endIndex = startIndex + 1;
  while (endIndex < lines.length && !parseMomentEntryStart(lines[endIndex])) {
    endIndex++;
  }

  return { startIndex, endIndex };
}

function buildMomentEntryLines(
  startLine: string,
  text: string,
): { lines: string[]; changed: boolean } {
  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  if (!normalizedText) {
    return { lines: [startLine], changed: false };
  }

  const textLines = normalizedText.split("\n");

  // All patterns (task done, task todo, regular) are rewritten as plain `- HH:MM text`
  const taskDone = startLine.match(/^-\s+\[x\]\s+(\d{2}:\d{2})\s+(.*)$/i);
  if (taskDone) {
    const lines = [`- ${taskDone[1]} ${textLines[0]}`, ...textLines.slice(1)];
    return { lines, changed: true };
  }

  const taskTodo = startLine.match(/^-\s+\[ \]\s+(\d{2}:\d{2})\s+(.*)$/);
  if (taskTodo) {
    const lines = [`- ${taskTodo[1]} ${textLines[0]}`, ...textLines.slice(1)];
    return { lines, changed: true };
  }

  const regular = startLine.match(/^(-\s+)(\d{2}:\d{2})\s+(.*)$/);
  if (regular) {
    const lines = [`${regular[1]}${regular[2]} ${textLines[0]}`, ...textLines.slice(1)];
    return {
      lines,
      changed: lines.join("\n") !== startLine,
    };
  }

  return { lines: [startLine], changed: false };
}

function replaceMomentEntryBlock(
  lines: string[],
  range: { startIndex: number; endIndex: number },
  text: string,
): { lines: string[]; changed: boolean } {
  const result = buildMomentEntryLines(lines[range.startIndex], text);
  if (!result.changed) {
    return { lines, changed: false };
  }

  const nextLines = [
    ...lines.slice(0, range.startIndex),
    ...result.lines,
    ...lines.slice(range.endIndex),
  ];

  return {
    lines: nextLines,
    changed: nextLines.join("\n") !== lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Read/write operations
// ---------------------------------------------------------------------------

export function buildMomentsFeedDates(
  anchorDate: string,
  dayCount: number = MOMENTS_FEED_DAY_COUNT,
): string[] {
  const safeDayCount = normalizeMomentsFeedDayCount(dayCount);
  return Array.from({ length: safeDayCount }, (_, index) => offsetDate(anchorDate, -index));
}

export async function readMoments(notesDir: string, date: string): Promise<MomentEntry[]> {
  const filePath = getMomentsFilePath(notesDir, date);
  try {
    await fs.access(filePath);
  } catch {
    return [];
  }

  const raw = await fs.readFile(filePath, "utf8");
  // Strip front matter only — do NOT trim, so line indices stay consistent with toggleTask
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split("\n");
  const entries: MomentEntry[] = [];

  for (let i = 0; i < lines.length; ) {
    const start = parseMomentEntryStart(lines[i]);
    if (!start) {
      i++;
      continue;
    }

    const range = findMomentEntryRange(lines, i);
    if (!range) {
      i++;
      continue;
    }

    const textLines = [start.text, ...lines.slice(range.startIndex + 1, range.endIndex)];
    while (textLines.length > 1 && textLines[textLines.length - 1].trim() === "") {
      textLines.pop();
    }
    const text = textLines.join("\n");
    entries.push({
      index: range.startIndex,
      time: start.time,
      text,
      done: start.done,
      tags: extractMomentTags(text),
    });
    i = range.endIndex;
  }

  return entries;
}

export function mapMomentBodyIndexToFileLine(raw: string, bodyIndex: number): number {
  let bodyStart = 0;
  if (raw.startsWith("---")) {
    const fmEnd = raw.indexOf("\n---", 3);
    if (fmEnd !== -1) {
      bodyStart = raw.slice(0, fmEnd + 4).split("\n").length;
    }
  }

  return bodyStart + bodyIndex;
}

export function toggleMomentTaskLine(line: string): { line: string; changed: boolean } {
  if (line.match(/^(-\s+)\[x\]/i)) {
    return {
      line: line.replace(/^(-\s+)\[x\]/i, "$1[ ]"),
      changed: true,
    };
  }

  if (line.match(/^(-\s+)\[ \]/)) {
    return {
      line: line.replace(/^(-\s+)\[ \]/, "$1[x]"),
      changed: true,
    };
  }

  const regular = line.match(/^(-\s+)(\d{2}:\d{2}\s+.*)$/);
  if (regular) {
    return {
      line: `${regular[1]}[x] ${regular[2]}`,
      changed: true,
    };
  }

  return { line, changed: false };
}

export function normalizeMomentLineToUnchecked(line: string): { line: string; changed: boolean } {
  if (line.match(/^(-\s+)\[x\]/i)) {
    return {
      line: line.replace(/^(-\s+)\[x\]/i, "$1[ ]"),
      changed: true,
    };
  }

  if (line.match(/^(-\s+)\[ \]/)) {
    return { line, changed: false };
  }

  const regular = line.match(/^(-\s+)(\d{2}:\d{2}\s+.*)$/);
  if (!regular) {
    return { line, changed: false };
  }

  return {
    line: `${regular[1]}[ ] ${regular[2]}`,
    changed: true,
  };
}

export function replaceMomentEntryText(
  line: string,
  nextText: string,
): { line: string; changed: boolean } {
  const normalizedText = nextText.trim();
  if (!normalizedText) {
    return { line, changed: false };
  }

  // All patterns rewritten as plain `- HH:MM text` (no checkbox)
  const taskDone = line.match(/^-\s+\[x\]\s+(\d{2}:\d{2})\s+(.*)$/i);
  if (taskDone) {
    const nextLine = `- ${taskDone[1]} ${normalizedText}`;
    return { line: nextLine, changed: true };
  }

  const taskTodo = line.match(/^-\s+\[ \]\s+(\d{2}:\d{2})\s+(.*)$/);
  if (taskTodo) {
    const nextLine = `- ${taskTodo[1]} ${normalizedText}`;
    return { line: nextLine, changed: true };
  }

  const regular = line.match(/^(-\s+)(\d{2}:\d{2})\s+(.*)$/);
  if (regular) {
    const nextLine = `${regular[1]}${regular[2]} ${normalizedText}`;
    return {
      line: nextLine,
      changed: nextLine !== line,
    };
  }

  return { line, changed: false };
}

export function deleteMomentLine(
  lines: string[],
  lineIndex: number,
): {
  lines: string[];
  changed: boolean;
} {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return { lines, changed: false };
  }

  return {
    lines: [...lines.slice(0, lineIndex), ...lines.slice(lineIndex + 1)],
    changed: true,
  };
}

export function buildMomentsDateLabel(date: string, today: string): string {
  if (date === today) {
    return `Today · ${date}`;
  }

  return date;
}

export interface MomentsFeedData {
  sections: MomentDaySection[];
  hasMoreOlder: boolean;
}

export async function collectMomentsFeed(
  notesDir: string,
  anchorDate: string,
  sectionCount: number = getMomentsFeedDayCount(),
): Promise<MomentsFeedData> {
  const today = formatDate(new Date());
  const safeSectionCount = normalizeMomentsFeedDayCount(sectionCount);
  const fileDates = (await listMomentFileDates(notesDir)).filter((date) => date < anchorDate);
  const firstEntries = await readMoments(notesDir, anchorDate);
  const sections: MomentDaySection[] = [
    {
      date: anchorDate,
      dateLabel: buildMomentsDateLabel(anchorDate, today),
      isToday: anchorDate === today,
      entries: firstEntries,
    },
  ];
  let hasMoreOlder = false;

  for (const date of fileDates) {
    const entries = await readMoments(notesDir, date);
    if (entries.length === 0) {
      continue;
    }

    if (sections.length < safeSectionCount) {
      sections.push({
        date,
        dateLabel: buildMomentsDateLabel(date, today),
        isToday: date === today,
        entries,
      });
      continue;
    }

    hasMoreOlder = true;
    break;
  }

  return {
    sections,
    hasMoreOlder,
  };
}

export async function ensureMomentsFile(notesDir: string, date: string): Promise<string> {
  const filePath = getMomentsFilePath(notesDir, date);
  const dir = path.dirname(filePath);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `---\ntype: moments\ndate: ${date}\n---\n\n`, "utf8");
  }
  return filePath;
}

export async function appendMoment(notesDir: string, date: string, text: string): Promise<void> {
  const filePath = await ensureMomentsFile(notesDir, date);
  const time = formatTime(new Date());
  const entryText = text.replace(/\r\n/g, "\n").trim();
  const entry = `- ${time} ${entryText}\n`;

  let content = await fs.readFile(filePath, "utf8");
  if (!content.endsWith("\n")) {
    content += "\n";
  }
  await fs.writeFile(filePath, content + entry, "utf8");
}

export async function toggleTask(notesDir: string, date: string, index: number): Promise<void> {
  const filePath = getMomentsFilePath(notesDir, date);
  try {
    await fs.access(filePath);
  } catch {
    return;
  }

  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  if (fileLineIdx >= lines.length) {
    return;
  }

  const result = toggleMomentTaskLine(lines[fileLineIdx]);
  if (!result.changed) {
    return;
  }

  lines[fileLineIdx] = result.line;

  await fs.writeFile(filePath, lines.join("\n"), "utf8");
}

export async function saveMomentEdit(
  notesDir: string,
  date: string,
  index: number,
  text: string,
): Promise<boolean> {
  const filePath = getMomentsFilePath(notesDir, date);
  try {
    await fs.access(filePath);
  } catch {
    return false;
  }

  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  if (fileLineIdx < 0 || fileLineIdx >= lines.length) {
    return false;
  }

  const range = findMomentEntryRange(lines, fileLineIdx);
  if (!range) {
    return false;
  }

  const result = replaceMomentEntryBlock(lines, range, text);
  if (!result.changed) {
    return false;
  }

  await fs.writeFile(filePath, result.lines.join("\n"), "utf8");
  return true;
}

export async function deleteMomentEntry(
  notesDir: string,
  date: string,
  index: number,
): Promise<boolean> {
  const filePath = getMomentsFilePath(notesDir, date);
  try {
    await fs.access(filePath);
  } catch {
    return false;
  }

  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  const range = findMomentEntryRange(lines, fileLineIdx);
  if (!range) {
    return false;
  }

  const nextLines = [...lines.slice(0, range.startIndex), ...lines.slice(range.endIndex)];
  await fs.writeFile(filePath, nextLines.join("\n"), "utf8");
  return true;
}

export async function archiveMoments(
  notesDir: string,
): Promise<{ archived: number; skipped: number }> {
  const afterDays = getMomentsArchiveAfterDaysSetting();

  const momentsDir = getMomentsDirectory(notesDir);
  try {
    await fs.access(momentsDir);
  } catch {
    return { archived: 0, skipped: 0 };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - afterDays);
  const cutoffStr = formatDate(cutoffDate);

  const entries = await fs.readdir(momentsDir, { withFileTypes: true });
  const dateFilePattern = /^(\d{4}-\d{2}-\d{2})\.md$/;

  let archived = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = entry.name.match(dateFilePattern);
    if (!match) {
      continue;
    }

    const fileDate = match[1];
    if (fileDate >= cutoffStr) {
      skipped++;
      continue;
    }

    const yearMonth = fileDate.slice(0, 7);
    const archiveDir = path.join(momentsDir, "archive", yearMonth);
    await fs.mkdir(archiveDir, { recursive: true });

    const src = path.join(momentsDir, entry.name);
    const dest = path.join(archiveDir, entry.name);
    await fs.rename(src, dest);
    archived++;
  }

  return { archived, skipped };
}
