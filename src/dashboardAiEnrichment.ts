import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import type { Memento, CancellationToken } from "vscode";
import { TASK_RE, normalizeExtractedTaskIdentity } from "./dashboardTaskUtils.js";

export interface AiTaskEnrichment {
  category: string;
  priority: string;
  timeEstimateMin: number;
  enrichedAt: string;
}

function getEnrichmentStorageKey(notesDir: string): string {
  const notesKey = crypto.createHash("sha1").update(path.resolve(notesDir)).digest("hex");
  return `dashboard.aiEnrichment.${notesKey}`;
}

export function loadAllAiTaskEnrichments(
  stateStore: Memento,
  notesDir: string,
): Record<string, AiTaskEnrichment> {
  const storageKey = getEnrichmentStorageKey(notesDir);
  const raw = stateStore.get(storageKey);
  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, AiTaskEnrichment>;
  }
  return {};
}

export function saveAiTaskEnrichment(
  stateStore: Memento,
  notesDir: string,
  taskIdentityKey: string,
  enrichment: Omit<AiTaskEnrichment, "enrichedAt">,
): void {
  const storageKey = getEnrichmentStorageKey(notesDir);
  const all = loadAllAiTaskEnrichments(stateStore, notesDir);
  all[taskIdentityKey] = { ...enrichment, enrichedAt: new Date().toISOString() };
  void stateStore.update(storageKey, all);
}

export function getAiTaskEnrichment(
  stateStore: Memento,
  notesDir: string,
  taskIdentityKey: string,
): AiTaskEnrichment | null {
  const all = loadAllAiTaskEnrichments(stateStore, notesDir);
  return all[taskIdentityKey] ?? null;
}

export function deleteAiTaskEnrichment(
  stateStore: Memento,
  notesDir: string,
  taskIdentityKey: string,
): void {
  const storageKey = getEnrichmentStorageKey(notesDir);
  const all = loadAllAiTaskEnrichments(stateStore, notesDir);
  delete all[taskIdentityKey];
  void stateStore.update(storageKey, all);
}

export async function enrichTasksInFile(
  filePath: string,
  notesDir: string,
  stateStore: Memento,
  token: CancellationToken,
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n");
    const allEnrichments = loadAllAiTaskEnrichments(stateStore, notesDir);

    const tasksToEnrich: string[] = [];
    const seenKeys = new Set<string>();

    for (const line of lines) {
      const match = TASK_RE.exec(line);
      if (match) {
        const isDone = match[1].toLowerCase() === "x";
        if (!isDone) {
          const text = match[2].trim();
          const key = normalizeExtractedTaskIdentity(text);
          if (key && !allEnrichments[key] && !seenKeys.has(key)) {
            seenKeys.add(key);
            tasksToEnrich.push(text);
          }
        }
      }
    }

    if (tasksToEnrich.length === 0) {
      return;
    }

    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (models.length === 0) {
      return;
    }
    const model = models[0];

    const prompt = `以下のタスク一覧の各項目について、カテゴリ、優先度、および所要時間（見積もり）を判定してください。
タスクの元の文字列は「絶対に」変更しないでください。JSON配列の "text" フィールドには、入力されたタスクのテキストをそのまま正確に出力してください。

各タスクについて以下のフィールドを持つオブジェクトのJSON配列として返してください:
- "text": 入力されたタスクのテキスト（変更せずそのまま）
- "category": "work" | "personal" | "health" | "learning" | "admin" のいずれか
- "priority": "high" | "medium" | "low" のいずれか
- "timeEstimateMin": 所要時間の見積もり（分、整数）

JSON 配列のみ返してください。その他の説明文や markdown 記法（\`\`\`json など）は不要です。

タスク一覧:
${tasksToEnrich.map((t) => `- ${t}`).join("\n")}`;

    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      token,
    );

    let raw = "";
    for await (const chunk of response.text) {
      raw += chunk;
    }

    const payload = extractJsonPayload(raw);
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object" && typeof item.text === "string") {
          const key = normalizeExtractedTaskIdentity(item.text);
          const category = typeof item.category === "string" ? item.category : "other";
          const priority = typeof item.priority === "string" ? item.priority : "medium";
          const timeEstimateMin = typeof item.timeEstimateMin === "number" ? item.timeEstimateMin : 0;

          saveAiTaskEnrichment(stateStore, notesDir, key, {
            category,
            priority,
            timeEstimateMin,
          });
        }
      }
    }
  } catch (e) {
    console.error("Failed to auto-enrich tasks in file:", e);
  }
}

function extractJsonPayload(text: string): string {
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

