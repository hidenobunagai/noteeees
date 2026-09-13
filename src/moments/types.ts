export interface MomentEntry {
  index: number; // 0-based line index in the body
  time: string; // HH:mm
  text: string; // content after the time
  tags?: string[];
}

export interface MomentDaySection {
  date: string;
  dateLabel: string;
  isToday: boolean;
  entries: MomentEntry[];
}

export interface PinnedEntryData {
  date: string;
  index: number;
  text: string;
  time: string;
}

export interface ResolvedPinnedEntryData extends PinnedEntryData {
  isAvailable: boolean;
}
