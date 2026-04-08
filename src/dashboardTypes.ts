export interface DashTask {
  id: string;
  filePath: string;
  lineIndex: number;
  text: string;
  done: boolean;
  date: string | null;
  dueDate: string | null;
  tags: string[];
}

export interface WeekDay {
  date: string;
  label: string;
  open: number;
  done: number;
}

export interface DismissedExtractedTask {
  key: string;
  dismissedAt: string;
}

export interface DashboardCandidateTask {
  kind: "candidate";
  text: string;
  dueDate: string | null;
  category: string;
  priority: string;
  timeEstimateMin: number;
  source: "moments" | "notes";
  sourceLabel: string;
  existsAlready: boolean;
  extractRunAt?: string;
}

export interface ExtractedTaskFilterResult {
  visibleTasks: DashboardCandidateTask[];
  hiddenExisting: number;
  hiddenDismissed: number;
  hiddenDuplicates: number;
}

export type DashboardTaskSection =
  | "overdue"
  | "today"
  | "upcoming"
  | "scheduled"
  | "backlog"
  | "unsorted"
  | "done";

export type DashboardListFilter =
  | "all"
  | "today"
  | "planned"
  | "done"
  | DashboardTaskSection;

export interface DashboardTaskView extends DashTask {
  kind: "task";
  relativePath: string;
  effectiveDate: string | null;
  section: DashboardTaskSection;
}

export interface DashboardCandidateView extends DashboardCandidateTask {
  extractionIndex: number;
  order?: number;
  added?: boolean;
}

export type DashboardListItem = DashboardTaskView | DashboardCandidateView;

export interface DashboardListSectionView {
  key: DashboardListFilter | "candidates";
  title: string;
  items: DashboardListItem[];
}

export interface DashboardListViewModel {
  sections: DashboardListSectionView[];
  flatItems?: DashboardListItem[];
  emptyMessage: string | null;
}

export interface DashboardCandidateStateMigration {
  candidateTasks: DashboardCandidateView[];
  candidateOrderSeed: number;
  addedCandidateKeys: string[];
}

export interface DashboardCandidateAddAck {
  requestId: string | null;
  status: "added" | "exists";
}

export interface DashboardSummary {
  totalOpen: number;
  attentionCount: number;
  overdueCount: number;
  totalDone: number;
  completionRate: number;
}

export interface DashboardData {
  today: string;
  tasks: DashboardTaskView[];
  week: WeekDay[];
  catCount: Record<string, number>;
  sectionCounts: Record<DashboardTaskSection, number>;
  summary: DashboardSummary;
  availableModels: Array<{ id: string; name: string }>;
}
