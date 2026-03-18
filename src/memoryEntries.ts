import * as fs from "fs";

export interface MemoryEntry {
  line: number;
  dateTime: string;
  tags: string[];
  content: string;
  checked: boolean;
  headerTail: string;
}

interface ParsedMemoryEntryHeader {
  dateTime: string;
  checked: boolean;
  tail: string;
  tags: string[];
}

const MEMORY_ENTRY_HEADER_REGEX = /^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)(?: (\[(?: |x|X)\]))?(.*)$/;

export function parseMemoryEntryHeader(line: string): ParsedMemoryEntryHeader | undefined {
  const headerMatch = line.match(MEMORY_ENTRY_HEADER_REGEX);
  if (!headerMatch) {
    return undefined;
  }

  const [, dateTime, checkboxToken, tail] = headerMatch;

  return {
    dateTime,
    checked: checkboxToken?.toLowerCase() === "[x]",
    tail: tail.trim(),
    tags: tail.match(/#[\w-]+/g) || [],
  };
}

export function formatMemoryEntryHeader(dateTime: string, tail: string, checked: boolean): string {
  const normalizedTail = tail.trim();
  const suffix = normalizedTail ? ` ${normalizedTail}` : "";
  return `## ${dateTime} [${checked ? "x" : " "}]${suffix}`;
}

export function updateMemoryEntryCheckbox(line: string, checked: boolean): string | undefined {
  const header = parseMemoryEntryHeader(line);
  if (!header) {
    return undefined;
  }

  return formatMemoryEntryHeader(header.dateTime, header.tail, checked);
}

export function formatMemoryEntryLabel(entry: Pick<MemoryEntry, "checked" | "dateTime" | "tags">): string {
  const tagSection = entry.tags.join(" ");
  return `${entry.checked ? "[x]" : "[ ]"} ${entry.dateTime}${tagSection ? ` ${tagSection}` : ""}`;
}

export function getMemoryEntryPreview(content: string, maxLength: number): string {
  return content.substring(0, maxLength).replace(/\n/g, " ");
}

export function parseMemoryFile(memoryPath: string): MemoryEntry[] {
  if (!fs.existsSync(memoryPath)) {
    return [];
  }

  return parseMemoryText(fs.readFileSync(memoryPath, "utf8"));
}

export function parseMemoryText(content: string): MemoryEntry[] {
  const lines = content.split("\n");
  const entries: MemoryEntry[] = [];

  let currentEntry: MemoryEntry | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = parseMemoryEntryHeader(line);

    if (header) {
      if (currentEntry) {
        entries.push(currentEntry);
      }

      currentEntry = {
        line: i,
        dateTime: header.dateTime,
        tags: header.tags,
        content: "",
        checked: header.checked,
        headerTail: header.tail,
      };
    } else if (currentEntry && line.trim() && !line.startsWith("# ")) {
      currentEntry.content += (currentEntry.content ? "\n" : "") + line;
    }
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}
