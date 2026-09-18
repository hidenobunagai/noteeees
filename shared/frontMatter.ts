// Delimiters may carry trailing spaces/tabs (`--- ` is valid YAML document syntax).
const FRONT_MATTER_RE = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/;

/**
 * Front matter and line indices are only comparable on normalized text: a CRLF
 * file would otherwise never match `^---\n`, and a BOM would keep `^` from
 * anchoring at all. Normalizing never changes the line count, so a line index
 * taken from the body still maps onto the raw file by `bodyStartLine`.
 */
function normalizeNoteText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export interface NoteBody {
  /** Note text with the BOM and any front matter removed, LF-separated. */
  body: string;
  /** 0-based line in the raw file where `body` starts. */
  bodyStartLine: number;
}

/** Splits a note into its body and the file line where that body starts. */
export function parseNoteBody(raw: string): NoteBody {
  const content = normalizeNoteText(raw);
  const match = FRONT_MATTER_RE.exec(content);
  if (!match) {
    return { body: content, bodyStartLine: 0 };
  }

  return {
    body: content.slice(match[0].length),
    bodyStartLine: match[0].split("\n").length - 1,
  };
}

export function stripFrontMatter(content: string): string {
  return parseNoteBody(content).body;
}

export function stripFrontMatterTrimmed(content: string): string {
  return stripFrontMatter(content).trim();
}

export function hasFrontMatter(content: string): boolean {
  return FRONT_MATTER_RE.test(normalizeNoteText(content));
}
