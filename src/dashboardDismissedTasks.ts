import type { Memento } from "vscode";
import {
  normalizeDismissedExtractedTasks,
  normalizeExtractedTaskIdentity,
  notesDirHash,
  pruneDismissedExtractedTasks,
  todayDateString,
} from "./dashboardTaskUtils.js";
import type { DismissedExtractedTask } from "./dashboardTypes.js";

export function getDismissedExtractedStorageKey(notesDir: string): string {
  return `dashboard.dismissedExtracted.${notesDirHash(notesDir)}`;
}

export function loadDismissedExtractedTasks(
  stateStore: Memento,
  notesDir: string,
): DismissedExtractedTask[] {
  const storageKey = getDismissedExtractedStorageKey(notesDir);
  const entries = normalizeDismissedExtractedTasks(stateStore.get(storageKey, []));
  const pruned = pruneDismissedExtractedTasks(entries);

  if (pruned.length !== entries.length) {
    void stateStore.update(storageKey, pruned);
  }

  return pruned;
}

export function dismissExtractedTask(stateStore: Memento, notesDir: string, text: string): void {
  const key = normalizeExtractedTaskIdentity(text);
  if (!key) {
    return;
  }

  const storageKey = getDismissedExtractedStorageKey(notesDir);
  const nextEntries = pruneDismissedExtractedTasks(
    loadDismissedExtractedTasks(stateStore, notesDir)
      .filter((entry) => entry.key !== key)
      .concat([{ key, dismissedAt: todayDateString() }]),
  );
  void stateStore.update(storageKey, nextEntries);
}
