export const TASK_RE = /^- \[([ xX])\] (.+)$/;
export const TAG_RE = /#[\w\u3040-\u9FFF\u4E00-\u9FFF-]+/g;
export const DUE_DATE_RE = /(?:📅|#?due:|@)(\d{4}-\d{2}-\d{2})/i;

export function extractDueDate(text: string): string | null {
  const match = DUE_DATE_RE.exec(text);
  return match ? match[1] : null;
}
