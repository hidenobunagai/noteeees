import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { extractMomentTags, getMomentsSubfolder, getMomentsFeedDayCount, MOMENTS_FEED_DAY_COUNT, normalizeMomentsFeedDayCount } from "./config.js";
import type { MomentEntry, MomentDaySection } from "./types.js";

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

export function readMoments(notesDir: string, date: string): MomentEntry[] {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  // Strip front matter only — do NOT trim, so line indices stay consistent with toggleTask
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split("\n");
  const entries: MomentEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    // Checked:     - [x] HH:mm text
    // Unchecked:   - [ ] HH:mm text
    // Legacy:      - HH:mm text
    const taskDone = line.match(/^-\s+\[x\]\s+(\d{2}:\d{2})\s+(.*)/i);
    const taskTodo = line.match(/^-\s+\[ \]\s+(\d{2}:\d{2})\s+(.*)/i);
    const regular = line.match(/^-\s+(\d{2}:\d{2})\s+(.*)/);

    if (taskDone) {
      entries.push({
        index: i,
        time: taskDone[1],
        text: taskDone[2],
        done: true,
        tags: extractMomentTags(taskDone[2]),
      });
    } else if (taskTodo) {
      entries.push({
        index: i,
        time: taskTodo[1],
        text: taskTodo[2],
        done: false,
        tags: extractMomentTags(taskTodo[2]),
      });
    } else if (regular) {
      entries.push({
        index: i,
        time: regular[1],
        text: regular[2],
        done: false,
        tags: extractMomentTags(regular[2]),
      });
    }
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

  const taskDone = line.match(/^(-\s+\[x\]\s+)(\d{2}:\d{2})\s+(.*)$/i);
  if (taskDone) {
    return {
      line: `${taskDone[1]}${taskDone[2]} ${normalizedText}`,
      changed: taskDone[3] !== normalizedText,
    };
  }

  const taskTodo = line.match(/^(-\s+\[ \]\s+)(\d{2}:\d{2})\s+(.*)$/);
  if (taskTodo) {
    return {
      line: `${taskTodo[1]}${taskTodo[2]} ${normalizedText}`,
      changed: taskTodo[3] !== normalizedText,
    };
  }

  const regular = line.match(/^(-\s+)(\d{2}:\d{2})\s+(.*)$/);
  if (regular) {
    const nextLine = `${regular[1]}[ ] ${regular[2]} ${normalizedText}`;
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

export function collectMomentsFeed(notesDir: string, anchorDate: string): MomentDaySection[] {
  const today = formatDate(new Date());
  const feedDayCount = getMomentsFeedDayCount();

  return buildMomentsFeedDates(anchorDate, feedDayCount)
    .map((date) => ({
      date,
      dateLabel: buildMomentsDateLabel(date, today),
      isToday: date === today,
      entries: readMoments(notesDir, date),
    }))
    .filter((section, index) => index === 0 || section.entries.length > 0);
}

export function ensureMomentsFile(notesDir: string, date: string): string {
  const filePath = getMomentsFilePath(notesDir, date);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `---\ntype: moments\ndate: ${date}\n---\n\n`, "utf8");
  }
  return filePath;
}

export function appendMoment(notesDir: string, date: string, text: string): void {
  const filePath = ensureMomentsFile(notesDir, date);
  const time = formatTime(new Date());
  const entry = `- [ ] ${time} ${text.trim()}\n`;

  let content = fs.readFileSync(filePath, "utf8");
  // Ensure ends with newline before appending
  if (!content.endsWith("\n")) {
    content += "\n";
  }
  fs.writeFileSync(filePath, content + entry, "utf8");
}

export function toggleTask(notesDir: string, date: string, index: number): void {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  // Preserve front matter as-is; work on full file lines
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

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

export function saveMomentEdit(notesDir: string, date: string, index: number, text: string): boolean {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  if (fileLineIdx < 0 || fileLineIdx >= lines.length) {
    return false;
  }

  const result = replaceMomentEntryText(lines[fileLineIdx], text);
  if (!result.changed) {
    return false;
  }

  lines[fileLineIdx] = result.line;
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return true;
}

export function deleteMomentEntry(notesDir: string, date: string, index: number): boolean {
  const filePath = getMomentsFilePath(notesDir, date);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const fileLineIdx = mapMomentBodyIndexToFileLine(raw, index);
  const result = deleteMomentLine(lines, fileLineIdx);
  if (!result.changed) {
    return false;
  }

  fs.writeFileSync(filePath, result.lines.join("\n"), "utf8");
  return true;
}

export async function archiveMoments(notesDir: string): Promise<{ archived: number; skipped: number }> {
  const config = vscode.workspace.getConfiguration("notes");
  const afterDays = Math.max(1, config.get<number>("momentsArchiveAfterDays") ?? 90);

  const momentsDir = getMomentsDirectory(notesDir);
  if (!fs.existsSync(momentsDir)) {
    return { archived: 0, skipped: 0 };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - afterDays);
  const cutoffStr = formatDate(cutoffDate);

  const entries = fs.readdirSync(momentsDir, { withFileTypes: true });
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
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const src = path.join(momentsDir, entry.name);
    const dest = path.join(archiveDir, entry.name);
    fs.renameSync(src, dest);
    archived++;
  }

  return { archived, skipped };
}
