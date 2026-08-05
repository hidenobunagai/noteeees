import * as vscode from "vscode";
import { t } from "./i18n.js";

export type TaskCategory = "work" | "personal" | "health" | "learning" | "admin" | "other";

export interface ExtractedTask {
  text: string;
  category: TaskCategory;
  priority: "high" | "medium" | "low";
  timeEstimateMin: number;
  dueDate?: string | null;
}

export interface NoteContent {
  filename: string;
  title: string;
  content: string;
  createdAt: string | null;
}

export interface McpClient {
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

export type ExtractTasksFailureReason = "modelUnavailable" | "requestFailed" | null;

export interface ExtractTasksResult {
  tasks: ExtractedTask[];
  failureReason: ExtractTasksFailureReason;
}

export interface CopilotModel {
  id: string;
  name: string;
  vendor: string;
  family: string;
}

export function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  const fencedMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  for (const match of fencedMatches) {
    const candidate = match[1].trim();
    if (candidate.startsWith("[") || candidate.startsWith("{")) {
      return candidate;
    }
  }

  const arrayStart = trimmed.indexOf("[");
  const objectStart = trimmed.indexOf("{");
  const startCandidates = [arrayStart, objectStart].filter((index) => index >= 0);

  if (startCandidates.length === 0) {
    return trimmed;
  }

  return trimmed.slice(Math.min(...startCandidates)).trim();
}

function parseExtractedTasks(raw: string): ExtractedTask[] | null {
  const parsed = JSON.parse(extractJsonPayload(raw)) as unknown;

  if (Array.isArray(parsed)) {
    return parsed as ExtractedTask[];
  }

  return null;
}

let cachedModels: { models: CopilotModel[]; at: number } | undefined;
const MODELS_CACHE_TTL_MS = 60_000;

export async function listCopilotModels(): Promise<CopilotModel[]> {
  const now = Date.now();
  if (cachedModels && now - cachedModels.at < MODELS_CACHE_TTL_MS) {
    return cachedModels.models;
  }

  try {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    const mapped = models.map((model) => ({
      id: model.id,
      name: model.name,
      vendor: model.vendor,
      family: model.family,
    }));
    cachedModels = { models: mapped, at: now };
    return mapped;
  } catch {
    return [];
  }
}

async function getModel(modelId?: string): Promise<vscode.LanguageModelChat | null> {
  try {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (models.length === 0) {
      return null;
    }

    // If a specific model is requested, try to find it
    if (modelId) {
      const selectedModel = models.find((m) => m.id === modelId);
      if (selectedModel) {
        return selectedModel;
      }
    }

    // Default to first available model
    return models[0];
  } catch {
    return null;
  }
}

export async function extractTasksFromTextWithStatus(
  text: string,
  token: vscode.CancellationToken,
  modelId?: string,
): Promise<ExtractTasksResult> {
  const model = await getModel(modelId);
  if (!model) {
    return {
      tasks: [],
      failureReason: "modelUnavailable",
    };
  }

  const prompt = `${t("promptExtractTasks")}${text}`;

  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      token,
    );
    let raw = "";
    for await (const chunk of response.text) {
      raw += chunk;
    }
    const parsed = parseExtractedTasks(raw);
    if (!parsed) {
      return {
        tasks: [],
        failureReason: "requestFailed",
      };
    }
    return {
      tasks: parsed,
      failureReason: null,
    };
  } catch {
    return {
      tasks: [],
      failureReason: "requestFailed",
    };
  }
}

export interface ExtractedTaskWithSource extends ExtractedTask {
  sourceNote: string;
}

export async function extractTasksFromNotes(
  noteContents: NoteContent[],
  token: vscode.CancellationToken,
  modelId?: string,
): Promise<ExtractedTaskWithSource[]> {
  const allTasks: ExtractedTaskWithSource[] = [];

  for (const note of noteContents) {
    if (token.isCancellationRequested) {
      break;
    }

    const result = await extractTasksFromTextWithStatus(note.content, token, modelId);
    for (const task of result.tasks) {
      allTasks.push({
        ...task,
        sourceNote: note.filename,
      });
    }
  }

  return allTasks;
}
