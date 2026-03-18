export interface MomentEntry {
  index: number; // 0-based line index in the body
  time: string; // HH:mm
  text: string; // content after the time
  done: boolean;
  tags?: string[];
}

export interface MomentDaySection {
  date: string;
  dateLabel: string;
  isToday: boolean;
  entries: MomentEntry[];
}

export interface TaskOverviewItem {
  date: string;
  time: string;
  text: string;
  filePath: string;
  relativePath: string;
  fileLineIndex: number;
  done: boolean;
}

export type MomentFilter = "all" | "open";
export type InboxTaskFilter = "all" | "open" | "done" | "overdue";
