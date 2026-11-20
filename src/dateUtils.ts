function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatTimeHM(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function todayDateString(): string {
  return formatDateString(new Date());
}

export function shiftDate(baseDate: string, days: number): string {
  const d = new Date(`${baseDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDateString(d);
}

const DATE_STRING_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether a `YYYY-MM-DD` string names a date that actually exists.
 * The shape alone is not enough: `new Date("2026-02-30")` silently rolls
 * over to March 1, so the components are round-tripped through a local
 * Date and compared — Feb 30, month 13, day 0 and Feb 29 on a non-leap
 * year all shift a component and fail, while real dates (including leap
 * days) survive unchanged.
 */
export function isRealCalendarDate(date: string): boolean {
  const match = DATE_STRING_PATTERN.exec(date);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  );
}
