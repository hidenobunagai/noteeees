const FRONT_MATTER_RE = /^---\n[\s\S]*?\n---\n/;

export function stripFrontMatter(content: string): string {
  return content.replace(FRONT_MATTER_RE, "");
}

export function stripFrontMatterTrimmed(content: string): string {
  return stripFrontMatter(content).trim();
}

export function hasFrontMatter(content: string): boolean {
  return FRONT_MATTER_RE.test(content);
}
