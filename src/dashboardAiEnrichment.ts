import * as crypto from "crypto";
import * as path from "path";
import type { Memento } from "vscode";

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
