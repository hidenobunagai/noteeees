import * as fs from "fs/promises";
import * as path from "path";
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
} from "./dashboardTaskUtils.js";
import type { DashTask, DashboardCandidateTask, DismissedExtractedTask } from "./dashboardTypes.js";

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

export async function collectDashboardMomentsText(
  notesDir: string,
  momentsSubfolder: string,
  fromDate: string,
  toDate: string,
): Promise<{ combinedText: string; datesWithContent: string[] }> {
  const allCleanTexts: string[] = [];
  const datesWithContent: string[] = [];
  const startDate = new Date(fromDate);
  const endDate = new Date(toDate);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const momentsFile = path.join(notesDir, momentsSubfolder, `${dateStr}.md`);

    let content: string;
    try {
      content = await fs.readFile(momentsFile, "utf8");
    } catch {
      continue;
    }

    const body = content.replace(/^---[\s\S]*?---\s*/m, "").trim();
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
  const momentsAbsPath = path.resolve(notesDir, momentsSubfolder);

  const collectFiles = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) === momentsAbsPath) {
          continue;
        }

        await collectFiles(fullPath);
        continue;
      }

      if (!entry.name.endsWith(".md")) {
        continue;
      }

      const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) {
        continue;
      }

      const fileDate = dateMatch[1];
      if (fileDate < fromDate || fileDate > toDate) {
        continue;
      }

      try {
        const content = await fs.readFile(fullPath, "utf8");
        results.push({
          filename: path.relative(notesDir, fullPath),
          title: entry.name.replace(/\.md$/, ""),
          content,
          createdAt: fileDate,
        });
      } catch {
        // Skip files that can't be read.
      }
    }
  };

  await collectFiles(notesDir);
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
      message: `${fromDate} ～ ${toDate} の期間に該当する Moments が見つかりません。`,
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
    message: `${datesWithContent.length}日分の Moments から${filtered.visibleTasks.length}件のタスク候補を抽出しました。`,
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
      message: `${fromDate} ～ ${toDate} の期間に該当するノートが見つかりません。`,
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
    message: `${noteContents.length}件のノートから${filtered.visibleTasks.length}件のタスク候補を抽出しました。`,
    tasks: filtered.visibleTasks,
  };
}
