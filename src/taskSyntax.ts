export const TASK_RE = /^- \[([ xX])\] (.+)$/;
export const TAG_RE = /#[\w\u3040-\u9FFF\u4E00-\u9FFF-]+/g;
export const DUE_DATE_RE = /(?:📅|#?due:|@)(\d{4}-\d{2}-\d{2})/i;

const DUE_DATE_STRIP_RE = /\s*(?:📅|#?due:|@)(\d{4}-\d{2}-\d{2})\b/gi;

export function extractDueDate(text: string): string | null {
  const match = DUE_DATE_RE.exec(text);
  return match ? match[1] : null;
}

export function stripDueDateTokens(text: string): string {
  return text.replace(DUE_DATE_STRIP_RE, "").replace(/\s{2,}/g, " ").trim();
}
