import type { DashboardSummary, DashboardTaskSection, DashboardTaskView } from "./dashboardTypes.js";
import { ATTENTION_SECTIONS } from "./dashboardTaskUtils.js";

export function buildSectionCounts(tasks: DashboardTaskView[]): Record<DashboardTaskSection, number> {
  const counts: Record<DashboardTaskSection, number> = {
    overdue: 0,
    today: 0,
    upcoming: 0,
    scheduled: 0,
    backlog: 0,
    unsorted: 0,
    done: 0,
  };

  for (const task of tasks) {
    counts[task.section]++;
  }

  return counts;
}

export function buildCategoryCounts(tasks: DashboardTaskView[]): Record<string, number> {
  const categories = ["work", "personal", "health", "learning", "admin", "other"];
  const counts: Record<string, number> = {};
  for (const category of categories) {
    counts[category] = 0;
  }

  for (const task of tasks) {
    if (task.done) {
      continue;
    }

    let matched = false;
    for (const tag of task.tags) {
      const normalized = tag.replace("#", "").toLowerCase();
      if (normalized in counts && normalized !== "other") {
        counts[normalized]++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      counts.other++;
    }
  }

  return counts;
}

export function buildSummary(
  tasks: DashboardTaskView[],
  sectionCounts: Record<DashboardTaskSection, number>,
): DashboardSummary {
  const totalDone = sectionCounts.done;
  const totalOpen = tasks.length - totalDone;
  const completionRate = tasks.length > 0 ? Math.round((totalDone / tasks.length) * 100) : 0;

  return {
    totalOpen,
    attentionCount: tasks.filter((task) => !task.done && ATTENTION_SECTIONS.has(task.section))
      .length,
    overdueCount: sectionCounts.overdue,
    totalDone,
    completionRate,
  };
}
