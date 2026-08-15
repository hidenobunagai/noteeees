/**
 * Strip a leading date/datetime prefix from a filename stem.
 * Recognised patterns (separator = '-' or '_'):
 *   YYYY-MM-DD_HH-mm_  (e.g. 2026-02-11_15-40_)
 *   YYYY-MM-DD_HH-mm-ss_ (with seconds)
 *   YYYY-MM-DD_  or  YYYY_MM_DD_
 *   YYYY-MM-DD   (followed by space)
 * Returns { title, datePrefix } where datePrefix is the matched date string
 * (without trailing separator), or empty string if none matched.
 */
export function stripDatePrefix(
  basename: string,
): { title: string; datePrefix: string } {
  const match = basename.match(
    /^(\d{4}[-_]\d{2}[-_]\d{2}(?:[-_]\d{2}[-_]\d{2}(?:[-_]\d{2})?)?)[-_ ](.*)/,
  );
  if (match && match[2]) {
    return { title: match[2], datePrefix: match[1] };
  }
  return { title: basename, datePrefix: "" };
}

/** Convenience wrapper returning only the stripped title. */
export function stripDatePrefixTitle(stem: string): string {
  return stripDatePrefix(stem).title;
}
