import type {
  DashTask,
  DashboardCandidateTask,
  DashboardCandidateView,
  DashboardTaskSection,
  DashboardTaskView,
  WeekDay,
} from "./dashboardTypes.js";
import {
  getRelativePathFromTaskId,
  SECTION_ORDER,
  shiftDate,
  todayDateString,
} from "./dashboardTaskUtils.js";

export function buildUpcomingWeek(tasks: DashTask[], today = todayDateString()): WeekDay[] {
  const days: WeekDay[] = [];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < 7; i++) {
    const date = shiftDate(today, i);
    const d = new Date(`${date}T00:00:00`);
    days.push({
      date,
      label: labels[d.getDay()],
      open: 0,
      done: 0,
    });
  }

  const weekDaysByDate = new Map(days.map((day) => [day.date, day]));
  for (const task of tasks) {
    const effectiveDate = task.dueDate ?? task.date;
    if (!effectiveDate) {
      continue;
    }

    const day = weekDaysByDate.get(effectiveDate);
    if (!day) {
      continue;
    }

    if (task.done) {
      day.done++;
    } else {
      day.open++;
    }
  }

  return days;
}

export function classifyDashboardTask(
  task: DashTask,
  today: string,
  horizonDate: string,
): DashboardTaskSection {
  if (task.done) {
    return "done";
  }

  const effectiveDate = task.dueDate ?? task.date;
  if (!effectiveDate) {
    return "backlog";
  }

  if (effectiveDate < today) {
    return "overdue";
  }

  if (effectiveDate === today) {
    return "today";
  }

  if (effectiveDate <= horizonDate) {
    return "upcoming";
  }

  return "scheduled";
}

function compareDashboardTasks(a: DashboardTaskView, b: DashboardTaskView): number {
  const sectionDiff = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
  if (sectionDiff !== 0) {
    return sectionDiff;
  }

  if (a.done !== b.done) {
    return a.done ? 1 : -1;
  }

  const aDate = a.effectiveDate ?? "";
  const bDate = b.effectiveDate ?? "";
  if (aDate && bDate && aDate !== bDate) {
    return a.section === "done" ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
  }

  if (aDate && !bDate) {
    return -1;
  }

  if (!aDate && bDate) {
    return 1;
  }

  const pathDiff = a.relativePath.localeCompare(b.relativePath);
  if (pathDiff !== 0) {
    return pathDiff;
  }

  return a.text.localeCompare(b.text);
}

export function buildDashboardTaskViews(tasks: DashTask[], today: string): DashboardTaskView[] {
  const horizonDate = shiftDate(today, 7);
  return tasks
    .map((task): DashboardTaskView => {
      const relativePath = getRelativePathFromTaskId(task.id, task.filePath);
      const effectiveDate = task.dueDate ?? task.date;
      return {
        ...task,
        kind: "task",
        relativePath,
        effectiveDate,
        section: classifyDashboardTask(task, today, horizonDate),
      };
    })
    .sort(compareDashboardTasks);
}

export function buildDashboardCandidateViews(
  tasks: DashboardCandidateTask[],
): DashboardCandidateView[] {
  return tasks.map((task, extractionIndex) => ({
    ...task,
    extractionIndex,
  }));
}
