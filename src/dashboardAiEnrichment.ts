import * as fs from "fs/promises";
import * as vscode from "vscode";
import type { Memento, CancellationToken } from "vscode";
import { TASK_RE, normalizeExtractedTaskIdentity, notesDirHash } from "./dashboardTaskUtils.js";
import { extractJsonPayload } from "./aiTaskProcessor.js";
import { t } from "./i18n.js";

export interface AiTaskEnrichment {
  category: string;
  priority: string;
  timeEstimateMin: number;
  enrichedAt: string;
}

function getEnrichmentStorageKey(notesDir: string): string {
  return `dashboard.aiEnrichment.${notesDirHash(notesDir)}`;
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

    const prompt = `${t("promptEnrichTasks")}${tasksToEnrich.map((task) => `- ${task}`).join("\n")}`;

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
          const timeEstimateMin =
            typeof item.timeEstimateMin === "number" ? item.timeEstimateMin : 0;

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
