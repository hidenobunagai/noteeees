import * as fs from "fs/promises";
import * as path from "path";
import { collectNoteFiles } from "../shared/collectNoteFiles.js";
import type { CancellationToken } from "vscode";
import {
  extractTasksFromNotes,
  extractTasksFromTextWithStatus,
  type ExtractTasksResult,
  type ExtractedTaskWithSource,
  type NoteContent,
} from "./aiTaskProcessor.js";
import { collectTasksFromNotes } from "./dashboardTaskCollector.js";
import {
  buildExtractedTaskFailureMessage,
  buildExtractedTaskStatusMessage,
  filterExtractedTasksForDisplay,
  formatDateString,
} from "./dashboardTaskUtils.js";
import { stripFrontMatterTrimmed } from "../shared/frontMatter.js";
import { t } from "./i18n.js";
import type { DashTask, DashboardCandidateTask, DismissedExtractedTask } from "./dashboardTypes.js";

export function buildMomentsCandidateSummary(dayCount: number, candidateCount: number): string {
  return t("extractedMomentsCount", { days: dayCount, count: candidateCount });
}

export function buildNotesCandidateSummary(noteCount: number, candidateCount: number): string {
  return t("extractedNotesCount", { notes: noteCount, count: candidateCount });
}

export interface DashboardExtractionResult {
  status: "error" | "done";
  message: string;
  tasks: DashboardCandidateTask[];
}

type ExtractTasksFromTextFn = (
  text: string,
  token: CancellationToken,
  modelId?: string,
) => Promise<ExtractTasksResult>;

type ExtractTasksFromNotesFn = (
  noteContents: NoteContent[],
  token: CancellationToken,
  modelId?: string,
) => Promise<ExtractedTaskWithSource[]>;

type CollectExistingTasksFn = (notesDir: string, momentsSubfolder?: string) => Promise<DashTask[]>;

/** Parses a YYYY-MM-DD string as a *local* midnight date (not UTC). */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export async function collectDashboardMomentsText(
  notesDir: string,
  momentsSubfolder: string,
  fromDate: string,
  toDate: string,
): Promise<{ combinedText: string; datesWithContent: string[] }> {
  const allCleanTexts: string[] = [];
  const datesWithContent: string[] = [];
  const startDate = parseLocalDate(fromDate);
  const endDate = parseLocalDate(toDate);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDateString(d);
    const momentsFile = path.join(notesDir, momentsSubfolder, `${dateStr}.md`);

    let content: string;
    try {
      content = await fs.readFile(momentsFile, "utf8");
    } catch {
      continue;
    }

    const body = stripFrontMatterTrimmed(content);
    const cleanText = body
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.replace(/^- (\d{2}:\d{2} )?/, "").trim())
      .filter(Boolean)
      .join("\n");

    if (!cleanText) {
      continue;
    }

    allCleanTexts.push(`[${dateStr}]\n${cleanText}`);
    datesWithContent.push(dateStr);
  }

  return {
    combinedText: allCleanTexts.join("\n\n"),
    datesWithContent,
  };
}

export async function collectDashboardNotesByDate(
  notesDir: string,
  fromDate: string,
  toDate: string,
  momentsSubfolder = "moments",
): Promise<NoteContent[]> {
  const results: NoteContent[] = [];
  const collected = await collectNoteFiles(notesDir, [momentsSubfolder]);

  for (const file of collected) {
    const dateMatch = path.basename(file.filePath).match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
      continue;
    }

    const fileDate = dateMatch[1];
    if (fileDate < fromDate || fileDate > toDate) {
      continue;
    }

    try {
      const content = await fs.readFile(file.filePath, "utf8");
      results.push({
        filename: file.relativePath,
        title: path.basename(file.filePath, ".md"),
        content,
        createdAt: fileDate,
      });
    } catch {
      // Skip files that can't be read.
    }
  }

  return results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function extractDashboardMomentsCandidates({
  notesDir,
  momentsSubfolder,
  fromDate,
  toDate,
  token,
  modelId,
  dismissedTasks,
  extractTasksFromText = extractTasksFromTextWithStatus,
  collectExistingTasks = collectTasksFromNotes,
}: {
  notesDir: string;
  momentsSubfolder: string;
  fromDate: string;
  toDate: string;
  token: CancellationToken;
  modelId?: string;
  dismissedTasks: DismissedExtractedTask[];
  extractTasksFromText?: ExtractTasksFromTextFn;
  collectExistingTasks?: CollectExistingTasksFn;
}): Promise<DashboardExtractionResult> {
  const { combinedText, datesWithContent } = await collectDashboardMomentsText(
    notesDir,
    momentsSubfolder,
    fromDate,
    toDate,
  );

  if (!combinedText) {
    return {
      status: "error",
      message: t("noMomentsInRange", { from: fromDate, to: toDate }),
      tasks: [],
    };
  }

  const extractionResult = await extractTasksFromText(combinedText, token, modelId);
  const existingTasks = await collectExistingTasks(notesDir, momentsSubfolder);
  const filtered = filterExtractedTasksForDisplay(
    extractionResult.tasks,
    existingTasks,
    dismissedTasks,
  );

  if (filtered.visibleTasks.length === 0) {
    return {
      status: "done",
      message:
        extractionResult.failureReason !== null
          ? buildExtractedTaskFailureMessage(extractionResult.failureReason)
          : buildExtractedTaskStatusMessage(filtered),
      tasks: [],
    };
  }

  return {
    status: "done",
    message: buildMomentsCandidateSummary(datesWithContent.length, filtered.visibleTasks.length),
    tasks: filtered.visibleTasks,
  };
}

export async function extractDashboardNotesCandidates({
  notesDir,
  momentsSubfolder,
  fromDate,
  toDate,
  token,
  modelId,
  dismissedTasks,
  extractTasksFromNotesForRange = extractTasksFromNotes,
  collectExistingTasks = collectTasksFromNotes,
  collectNotesByDate = collectDashboardNotesByDate,
}: {
  notesDir: string;
  momentsSubfolder: string;
  fromDate: string;
  toDate: string;
  token: CancellationToken;
  modelId?: string;
  dismissedTasks: DismissedExtractedTask[];
  extractTasksFromNotesForRange?: ExtractTasksFromNotesFn;
  collectExistingTasks?: CollectExistingTasksFn;
  collectNotesByDate?: typeof collectDashboardNotesByDate;
}): Promise<DashboardExtractionResult> {
  const noteContents = await collectNotesByDate(notesDir, fromDate, toDate, momentsSubfolder);
  if (noteContents.length === 0) {
    return {
      status: "error",
      message: t("noNotesInRange", { from: fromDate, to: toDate }),
      tasks: [],
    };
  }

  const extracted = await extractTasksFromNotesForRange(noteContents, token, modelId);
  const existingTasks = await collectExistingTasks(notesDir, momentsSubfolder);
  const filtered = filterExtractedTasksForDisplay(extracted, existingTasks, dismissedTasks);

  if (filtered.visibleTasks.length === 0) {
    return {
      status: "done",
      message: buildExtractedTaskStatusMessage(filtered),
      tasks: [],
    };
  }

  return {
    status: "done",
    message: buildNotesCandidateSummary(noteContents.length, filtered.visibleTasks.length),
    tasks: filtered.visibleTasks,
  };
}
