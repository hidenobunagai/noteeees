import type { DashboardCandidateStateMigration, DashboardCandidateView } from "./dashboardTypes.js";
import {
  normalizeDashboardCandidateTask,
  normalizeDashboardCandidateTaskForSource,
  normalizeExtractedTaskIdentity,
} from "./dashboardTaskUtils.js";

export function migrateDashboardCandidateState(savedState: {
  candidateTasks?: unknown;
  candidateOrderSeed?: unknown;
  addedCandidateKeys?: unknown;
  extractedTasks?: unknown;
  notesExtractedTasks?: unknown;
  addedExtractedKeys?: unknown;
  notesAddedExtractedKeys?: unknown;
}): DashboardCandidateStateMigration {
  if (Array.isArray(savedState.candidateTasks)) {
    const candidateTasks = savedState.candidateTasks
      .map((task): DashboardCandidateView | null => {
        const normalizedTask = normalizeDashboardCandidateTask(task);
        if (!normalizedTask) {
          return null;
        }

        const candidate = task as Partial<DashboardCandidateView>;
        return {
          ...normalizedTask,
          order: typeof candidate.order === "number" ? candidate.order : undefined,
          added: Boolean(candidate.added),
          extractionIndex:
            typeof candidate.extractionIndex === "number"
              ? candidate.extractionIndex
              : typeof candidate.order === "number"
                ? candidate.order
                : 0,
        };
      })
      .filter((task): task is DashboardCandidateView => task !== null);
    const maxOrder = candidateTasks.reduce((highest, task) => {
      return typeof task.order === "number" && task.order > highest ? task.order : highest;
    }, -1);
    return {
      candidateTasks,
      candidateOrderSeed:
        typeof savedState.candidateOrderSeed === "number"
          ? savedState.candidateOrderSeed
          : maxOrder + 1,
      addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
        ? (savedState.addedCandidateKeys as unknown[]).filter(
            (key): key is string => typeof key === "string" && key.length > 0,
          )
        : [],
    };
  }

  let nextOrder = 0;
  const fromMoments = (Array.isArray(savedState.extractedTasks) ? savedState.extractedTasks : [])
    .map((task): DashboardCandidateView | null => {
      const candidate = normalizeDashboardCandidateTaskForSource(task, "moments");
      if (!candidate) {
        return null;
      }

      return {
        ...candidate,
        order: nextOrder++,
        added: Array.isArray(savedState.addedExtractedKeys)
          ? savedState.addedExtractedKeys.includes(normalizeExtractedTaskIdentity(candidate.text))
          : false,
        extractionIndex: nextOrder - 1,
      };
    })
    .filter((task): task is DashboardCandidateView => task !== null);
  const fromNotes = (
    Array.isArray(savedState.notesExtractedTasks) ? savedState.notesExtractedTasks : []
  )
    .map((task): DashboardCandidateView | null => {
      const candidate = normalizeDashboardCandidateTaskForSource(task, "notes");
      if (!candidate) {
        return null;
      }

      return {
        ...candidate,
        order: nextOrder++,
        added: Array.isArray(savedState.notesAddedExtractedKeys)
          ? savedState.notesAddedExtractedKeys.includes(
              normalizeExtractedTaskIdentity(candidate.text),
            )
          : false,
        extractionIndex: nextOrder - 1,
      };
    })
    .filter((task): task is DashboardCandidateView => task !== null);

  return {
    candidateTasks: fromMoments.concat(fromNotes),
    candidateOrderSeed: nextOrder,
    addedCandidateKeys: (Array.isArray(savedState.addedExtractedKeys)
      ? (savedState.addedExtractedKeys as string[])
      : []
    ).concat(
      Array.isArray(savedState.notesAddedExtractedKeys)
        ? (savedState.notesAddedExtractedKeys as string[])
        : [],
    ),
  };
}
