import type {
  DashboardCandidateView,
  DashboardListFilter,
  DashboardListItem,
  DashboardListSectionView,
  DashboardListViewModel,
  DashboardTaskSection,
  DashboardTaskView,
} from "./dashboardTypes.js";
import { buildDashboardEmptyMessage } from "./dashboardTaskUtils.js";

export function buildDashboardListItems(
  tasks: DashboardTaskView[],
  candidates: DashboardCandidateView[],
): DashboardListItem[] {
  return [...tasks, ...candidates];
}

export function matchesDashboardListItemFilter(
  item: DashboardListItem,
  filter: DashboardListFilter,
): boolean {
  if (filter === "all") {
    return true;
  }

  if (item.kind === "candidate") {
    return false;
  }

  if (filter === "today") {
    return item.section === "overdue" || item.section === "today";
  }

  if (filter === "planned") {
    return item.section === "upcoming" || item.section === "scheduled";
  }

  if (filter === "done") {
    return item.section === "done";
  }

  return item.section === filter;
}

export function countDashboardListItemsForFilter(
  items: DashboardListItem[],
  filter: DashboardListFilter,
): number {
  return items.filter((item) => matchesDashboardListItemFilter(item, filter)).length;
}

function matchesDashboardListItemSearch(item: DashboardListItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    item.kind === "candidate"
      ? [
          item.text,
          item.sourceLabel,
          item.source,
          item.category,
          item.priority,
          item.dueDate ?? "",
          item.existsAlready ? "already exists" : "",
          "candidate",
        ]
      : [item.text, item.relativePath, item.date ?? "", item.dueDate ?? "", ...(item.tags || [])];

  return haystack.join(" ").toLowerCase().includes(normalizedQuery);
}

export function buildDashboardListViewModel(
  items: DashboardListItem[],
  filter: DashboardListFilter,
  search: string,
): DashboardListViewModel {
  const normalizedSearch = search.trim();
  const filteredItems = items.filter((item) => matchesDashboardListItemFilter(item, filter));
  const visibleItems = filteredItems.filter((item) => matchesDashboardListItemSearch(item, search));
  if (filter === "all") {
    if (normalizedSearch && visibleItems.length === 0) {
      return { sections: [], emptyMessage: "No matching tasks" };
    }

    if (!normalizedSearch && filteredItems.length === 0) {
      return { sections: [], emptyMessage: buildDashboardEmptyMessage("all") };
    }

    const sections: DashboardListSectionView[] = [];

    const simplifiedSectionOrder: Array<"today" | "planned" | "unsorted" | "done"> = [
      "today",
      "planned",
      "unsorted",
      "done",
    ];
    const simplifiedSectionTitles: Record<string, string> = {
      today: "Today",
      planned: "Planned",
      unsorted: "Unsorted",
      done: "Done",
    };

    for (const simplifiedSection of simplifiedSectionOrder) {
      let internalSections: DashboardTaskSection[];
      if (simplifiedSection === "today") {
        internalSections = ["overdue", "today"];
      } else if (simplifiedSection === "planned") {
        internalSections = ["upcoming", "scheduled"];
      } else if (simplifiedSection === "unsorted") {
        internalSections = ["backlog"];
      } else {
        internalSections = ["done"];
      }

      const taskItems = visibleItems.filter(
        (item): item is DashboardTaskView =>
          item.kind === "task" && internalSections.includes(item.section),
      );
      if (!normalizedSearch || taskItems.length > 0) {
        sections.push({
          key: simplifiedSection,
          title: simplifiedSectionTitles[simplifiedSection],
          items: taskItems,
        });
      }
    }

    return { sections, emptyMessage: null };
  }

  if (filteredItems.length === 0) {
    return { sections: [], emptyMessage: buildDashboardEmptyMessage(filter) };
  }

  if (visibleItems.length === 0) {
    return {
      sections: [],
      emptyMessage: normalizedSearch ? "No matching tasks" : buildDashboardEmptyMessage(filter),
    };
  }

  const simplifiedSectionTitles: Record<string, string> = {
    today: "Today",
    planned: "Planned",
    unsorted: "Unsorted",
    done: "Done",
  };
  const title = simplifiedSectionTitles[filter] || filter[0].toUpperCase() + filter.slice(1);

  return {
    sections: [],
    flatItems: visibleItems,
    emptyMessage: null,
  };
}
