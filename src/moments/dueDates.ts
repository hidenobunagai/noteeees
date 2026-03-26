export function parseDueDate(text: string): string | null {
  const match = text.match(/(?:📅|due:|@)(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
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
