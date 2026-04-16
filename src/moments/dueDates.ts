import { extractDueDate } from "../taskSyntax.js";

export function parseDueDate(text: string): string | null {
  return extractDueDate(text);
}

export type DueDateStatus = "overdue" | "today" | "upcoming" | null;

export function getDueDateStatus(
  dueDate: string | null,
  isDone: boolean,
  today: string,
): DueDateStatus {
  if (!dueDate || isDone) {
    return null;
  }

  if (dueDate < today) {
    return "overdue";
  }

  if (dueDate === today) {
    return "today";
  }

  return "upcoming";
}
