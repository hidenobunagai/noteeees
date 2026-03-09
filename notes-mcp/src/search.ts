import * as fs from "fs";
import * as path from "path";

export interface NoteEntry {
  filePath: string;
  filename: string;
  title: string;
  tags: string[];
  content: string;
  createdAt: string | null;
  mtime: number;
}

export interface SearchWeights {
  tagExact: number;
  filenameMatch: number;
  tagPartial: number;
  contentMatch: number;
  multiTokenBonus: number;
  allTokensBonus: number;
}

export type SearchStrategy = "auto" | "classic" | "hybrid_bm25";

export interface Bm25Options {
  k1: number;
  b: number;
  minDocumentCountForAuto: number;
  minQueryTokensForAuto: number;
  momentsPenalty: number;
}

export interface StructuredSearchRequest {
  query: string;
  limit?: number;
  include_recency_bonus?: boolean;
  synonyms?: string[];
  weights?: Partial<SearchWeights>;
  search_strategy?: SearchStrategy;
  explain?: boolean;
  bm25?: Partial<Bm25Options>;
}

export interface StructuredSearchResult {
  score: number;
  matchedTokenCount: number;
  reasons: string[];
  entry: Omit<NoteEntry, "filePath" | "content"> & { snippet: string };
}

export interface StructuredSearchResponse {
  query: string;
  queryTokens: string[];
  expandedTokens: string[];
  totalMatches: number;
  appliedStrategy: Exclude<SearchStrategy, "auto">;
  results: StructuredSearchResult[];
}

interface SearchEntry {
  note: NoteEntry;
  normalizedTags: string[];
  tagText: string;
  normalizedContent: string;
  normalizedFilename: string;
  normalizedTitle: string;
  documentLength: number;
  isMoments: boolean;
}

export interface SearchIndexSnapshot {
  notesDir: string;
  fileSignature: string;
  entries: SearchEntry[];
  averageDocumentLength: number;
  documentFrequencyCache: Map<string, number>;
}

const DEFAULT_WEIGHTS: SearchWeights = {
  tagExact: 6,
  filenameMatch: 4,
  tagPartial: 3,
  contentMatch: 2,
  multiTokenBonus: 3,
  allTokensBonus: 4,
};

const DEFAULT_BM25_OPTIONS: Bm25Options = {
  k1: 1.2,
  b: 0.75,
  minDocumentCountForAuto: 25,
  minQueryTokensForAuto: 2,
  momentsPenalty: 0.9,
};

const SNIPPET_RADIUS = 100;
const FREQ_CAP = 4;

let cachedSearchIndex: SearchIndexSnapshot | null = null;

function extractFrontMatter(rawContent: string): string | null {
  const match = rawContent.match(/^---\s*\n([\s\S]*?)\n---/);
  return match?.[1] ?? null;
}

function stripFrontMatter(rawContent: string): string {
  return rawContent.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trim();
}

function extractFrontMatterTags(rawContent: string): string[] {
  const frontMatter = extractFrontMatter(rawContent);
  if (!frontMatter) return [];
  const tagsLine = frontMatter.match(/^tags\s*:\s*(.+)$/m);
  if (!tagsLine) return [];
  const raw = tagsLine[1].replace(/[\[\]]/g, "");
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
}

function extractInlineTags(bodyContent: string): string[] {
  const matches = bodyContent.match(/#[\w-]+/g) || [];
  return [...new Set(matches)];
}

function extractTitle(rawContent: string, filename: string): string {
  const frontMatter = extractFrontMatter(rawContent);
  if (frontMatter) {
    const titleLine = frontMatter.match(/^title\s*:\s*(.+)$/m);
    if (titleLine) return titleLine[1].trim().replace(/^["']|["']$/g, "");
  }

  const headingMatch = rawContent.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return path.basename(filename, ".md");
}

function extractCreatedAt(filename: string): string | null {
  const base = path.basename(filename);
  const fullMatch = base.match(/^(\d{4}-\d{2}-\d{2})[_-](\d{2})[_-](\d{2})/);
  if (fullMatch) return `${fullMatch[1]} ${fullMatch[2]}:${fullMatch[3]}`;
  const dateOnly = base.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];
  return null;
}

function isMomentsNote(rawContent: string, filename: string): boolean {
  const frontMatter = extractFrontMatter(rawContent);
  if (frontMatter?.match(/^type\s*:\s*moments$/m)) return true;
  return filename.split(path.sep).includes("moments") || filename.split("/").includes("moments");
}

function collectNoteFiles(dir: string): { filePath: string; mtime: number }[] {
  const results: { filePath: string; mtime: number }[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectNoteFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const stat = fs.statSync(fullPath);
      results.push({ filePath: fullPath, mtime: stat.mtimeMs });
    }
  }

  return results.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function estimateDocumentLength(normalizedContent: string): number {
  const tokenCount = (normalizedContent.match(/#[\p{L}\p{N}_-]+|[\p{L}\p{N}_-]+/gu) ?? []).length;
  const charCount = normalizedContent.replace(/\s+/g, "").length;
  return Math.max(tokenCount, Math.ceil(charCount / 20), 1);
}

function createSearchEntry(note: NoteEntry): SearchEntry {
  const normalizedTags = note.tags.map((tag) => normalize(tag));
  const normalizedContent = normalize(note.content);
  const normalizedFilename = normalize(note.filename);
  const normalizedTitle = normalize(note.title);

  return {
    note,
    normalizedTags,
    tagText: normalizedTags.join(" "),
    normalizedContent,
    normalizedFilename,
    normalizedTitle,
    documentLength: estimateDocumentLength(normalizedContent),
    isMoments: note.filename.split("/").includes("moments"),
  };
}

function parseAllNoteFiles(notesDir: string, files: { filePath: string; mtime: number }[]): NoteEntry[] {
  const entries: NoteEntry[] = [];

  for (const { filePath, mtime } of files) {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const filename = path.relative(notesDir, filePath);
    const title = extractTitle(rawContent, filename);
    const frontMatterTags = extractFrontMatterTags(rawContent);
    const bodyContent = stripFrontMatter(rawContent);
    const inlineTags = extractInlineTags(bodyContent);
    const tags = [...new Set([...frontMatterTags, ...inlineTags])];
    const createdAt = extractCreatedAt(filename);

    entries.push({
      filePath,
      filename,
      title,
      tags,
      content: bodyContent,
      createdAt,
      mtime,
    });
  }

  entries.sort((left, right) => right.mtime - left.mtime);
  return entries;
}

function buildFileSignature(notesDir: string, files: { filePath: string; mtime: number }[]): string {
  return files
    .map(({ filePath, mtime }) => `${path.relative(notesDir, filePath)}:${mtime}`)
    .join("|");
}

export function createSearchIndexSnapshot(notesDir: string, notes: NoteEntry[]): SearchIndexSnapshot {
  const entries = notes.map(createSearchEntry);
  const totalDocumentLength = entries.reduce((sum, entry) => sum + entry.documentLength, 0);

  return {
    notesDir,
    fileSignature: `${notes.length}:${notes.map((note) => `${note.filename}:${note.mtime}`).join("|")}`,
    entries,
    averageDocumentLength: entries.length > 0 ? totalDocumentLength / entries.length : 1,
    documentFrequencyCache: new Map<string, number>(),
  };
}

export function clearSearchIndexCache(): void {
  cachedSearchIndex = null;
}

export function getCachedSearchIndex(notesDir: string): SearchIndexSnapshot {
  const files = collectNoteFiles(notesDir);
  const fileSignature = buildFileSignature(notesDir, files);

  if (
    cachedSearchIndex
    && cachedSearchIndex.notesDir === notesDir
    && cachedSearchIndex.fileSignature === fileSignature
  ) {
    return cachedSearchIndex;
  }

  const notes = parseAllNoteFiles(notesDir, files);
  const snapshot = createSearchIndexSnapshot(notesDir, notes);
  snapshot.fileSignature = fileSignature;
  cachedSearchIndex = snapshot;
  return snapshot;
}

export function getSearchIndexNotes(index: SearchIndexSnapshot): NoteEntry[] {
  return index.entries.map((entry) => entry.note);
}

export function extractSnippet(content: string, tokens: string[]): string {
  const normalizedContent = normalize(content);
  let bestIndex = -1;
  for (const token of tokens) {
    const index = normalizedContent.indexOf(token);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  if (bestIndex === -1) {
    return content.slice(0, SNIPPET_RADIUS * 2).replace(/\n+/g, " ").trim();
  }

  const start = Math.max(0, bestIndex - SNIPPET_RADIUS);
  const end = Math.min(content.length, bestIndex + SNIPPET_RADIUS);
  const snippet = content.slice(start, end).replace(/\n+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < content.length ? "…" : ""}`;
}

export function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => normalize(token))
    .filter((token) => token.length > 0);
}

export function toBoundedInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function getEffectiveWeights(overrides?: Partial<SearchWeights>): SearchWeights {
  return {
    tagExact: toBoundedInt(overrides?.tagExact ?? DEFAULT_WEIGHTS.tagExact, DEFAULT_WEIGHTS.tagExact, 1, 20),
    filenameMatch: toBoundedInt(overrides?.filenameMatch ?? DEFAULT_WEIGHTS.filenameMatch, DEFAULT_WEIGHTS.filenameMatch, 1, 20),
    tagPartial: toBoundedInt(overrides?.tagPartial ?? DEFAULT_WEIGHTS.tagPartial, DEFAULT_WEIGHTS.tagPartial, 1, 20),
    contentMatch: toBoundedInt(overrides?.contentMatch ?? DEFAULT_WEIGHTS.contentMatch, DEFAULT_WEIGHTS.contentMatch, 1, 20),
    multiTokenBonus: toBoundedInt(overrides?.multiTokenBonus ?? DEFAULT_WEIGHTS.multiTokenBonus, DEFAULT_WEIGHTS.multiTokenBonus, 0, 20),
    allTokensBonus: toBoundedInt(overrides?.allTokensBonus ?? DEFAULT_WEIGHTS.allTokensBonus, DEFAULT_WEIGHTS.allTokensBonus, 0, 20),
  };
}

function toBoundedFloat(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function getEffectiveBm25Options(overrides?: Partial<Bm25Options>): Bm25Options {
  return {
    k1: toBoundedFloat(overrides?.k1 ?? DEFAULT_BM25_OPTIONS.k1, DEFAULT_BM25_OPTIONS.k1, 0.1, 3),
    b: toBoundedFloat(overrides?.b ?? DEFAULT_BM25_OPTIONS.b, DEFAULT_BM25_OPTIONS.b, 0, 1),
    minDocumentCountForAuto: toBoundedInt(
      overrides?.minDocumentCountForAuto ?? DEFAULT_BM25_OPTIONS.minDocumentCountForAuto,
      DEFAULT_BM25_OPTIONS.minDocumentCountForAuto,
      1,
      10000,
    ),
    minQueryTokensForAuto: toBoundedInt(
      overrides?.minQueryTokensForAuto ?? DEFAULT_BM25_OPTIONS.minQueryTokensForAuto,
      DEFAULT_BM25_OPTIONS.minQueryTokensForAuto,
      1,
      20,
    ),
    momentsPenalty: toBoundedFloat(
      overrides?.momentsPenalty ?? DEFAULT_BM25_OPTIONS.momentsPenalty,
      DEFAULT_BM25_OPTIONS.momentsPenalty,
      0.1,
      1,
    ),
  };
}

function getRecencyBonus(mtime: number): number {
  const days = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
  if (days <= 7) return 4;
  if (days <= 30) return 3;
  if (days <= 90) return 2;
  if (days <= 180) return 1;
  return 0;
}

function getBuiltInSynonyms(): Map<string, string[]> {
  return new Map([
    ["経費", ["精算", "交通費", "出張費"]],
    ["会議", ["mtg", "ミーティング"]],
    ["タスク", ["todo", "課題"]],
    ["メモ", ["note", "ノート"]],
    ["バグ", ["bug", "不具合", "エラー"]],
  ]);
}

export function buildSynonymMap(customSynonyms?: string[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();

  for (const [key, values] of getBuiltInSynonyms()) {
    const normalizedKey = normalize(key);
    if (!map.has(normalizedKey)) map.set(normalizedKey, new Set());
    for (const value of values) {
      map.get(normalizedKey)?.add(normalize(value));
    }
  }

  for (const customRule of customSynonyms ?? []) {
    const [rawKey, rawValues] = customRule.split(":").map((segment) => segment.trim());
    if (!rawKey || !rawValues) continue;
    const normalizedKey = normalize(rawKey);
    if (!map.has(normalizedKey)) map.set(normalizedKey, new Set());
    for (const value of rawValues.split(",").map((segment) => normalize(segment.trim()))) {
      if (value.length > 0) map.get(normalizedKey)?.add(value);
    }
  }

  return new Map([...map.entries()].map(([key, values]) => [key, [...values]]));
}

export function expandTokens(tokens: string[], synonymMap: Map<string, string[]>): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const bareToken = token.startsWith("#") ? token.slice(1) : token;
    for (const synonym of synonymMap.get(bareToken) ?? []) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

function contentFrequencyScore(contentText: string, token: string, baseWeight: number): number {
  if (!contentText.includes(token)) return 0;

  let count = 0;
  let offset = 0;
  while ((offset = contentText.indexOf(token, offset)) !== -1) {
    count += 1;
    offset += token.length;
    if (count >= FREQ_CAP) break;
  }

  return baseWeight * Math.min(count, FREQ_CAP);
}

function countOccurrences(text: string, token: string): number {
  if (!token || !text.includes(token)) return 0;

  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(token, offset)) !== -1) {
    count += 1;
    offset += token.length;
  }

  return count;
}

function getDocumentFrequency(index: SearchIndexSnapshot, token: string): number {
  const cached = index.documentFrequencyCache.get(token);
  if (cached !== undefined) return cached;

  const documentFrequency = index.entries.reduce((count, entry) => (
    entry.normalizedContent.includes(token) ? count + 1 : count
  ), 0);

  index.documentFrequencyCache.set(token, documentFrequency);
  return documentFrequency;
}

function bm25ContentScore(
  entry: SearchEntry,
  token: string,
  index: SearchIndexSnapshot,
  bm25: Bm25Options,
): number {
  const termFrequency = countOccurrences(entry.normalizedContent, token);
  if (termFrequency === 0) return 0;

  const documentCount = index.entries.length;
  const documentFrequency = getDocumentFrequency(index, token);
  if (documentCount === 0 || documentFrequency === 0) return 0;

  const inverseDocumentFrequency = Math.log(1 + ((documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5)));
  const lengthNormalization = 1 - bm25.b + (bm25.b * (entry.documentLength / Math.max(index.averageDocumentLength, 1)));
  const termWeight = (termFrequency * (bm25.k1 + 1)) / (termFrequency + (bm25.k1 * lengthNormalization));
  const rawScore = inverseDocumentFrequency * termWeight;
  return entry.isMoments ? rawScore * bm25.momentsPenalty : rawScore;
}

function buildResultEntry(note: NoteEntry, tokens: string[]): StructuredSearchResult["entry"] {
  const { filePath: _filePath, content, ...entry } = note;
  return { ...entry, snippet: extractSnippet(content, tokens) };
}

function maybePushReason(reasons: string[], explain: boolean, reason: string): void {
  if (explain) reasons.push(reason);
}

function scoreEntryClassic(
  entry: SearchEntry,
  tokens: string[],
  weights: SearchWeights,
  includeRecencyBonus: boolean,
  explain: boolean,
): StructuredSearchResult {
  let score = 0;
  let matchedTokenCount = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    let tokenMatched = false;
    const tagToken = token.startsWith("#") ? token : `#${token}`;

    if (entry.normalizedTags.includes(tagToken)) {
      score += weights.tagExact;
      maybePushReason(reasons, explain, `tag:${tagToken}`);
      tokenMatched = true;
    }

    if (entry.normalizedFilename.includes(token) || entry.normalizedTitle.includes(token)) {
      score += weights.filenameMatch;
      maybePushReason(reasons, explain, `filename:${token}`);
      tokenMatched = true;
    }

    if (!entry.normalizedTags.includes(tagToken) && entry.tagText.includes(token)) {
      score += weights.tagPartial;
      maybePushReason(reasons, explain, `tag-partial:${token}`);
      tokenMatched = true;
    }

    const frequencyScore = contentFrequencyScore(entry.normalizedContent, token, weights.contentMatch);
    if (frequencyScore > 0) {
      score += frequencyScore;
      maybePushReason(reasons, explain, `content:${token}(x${Math.round(frequencyScore / weights.contentMatch)})`);
      tokenMatched = true;
    }

    if (tokenMatched) matchedTokenCount += 1;
  }

  if (matchedTokenCount >= 2) {
    score += weights.multiTokenBonus;
    maybePushReason(reasons, explain, "bonus:multi-token");
  }

  if (tokens.length > 0 && matchedTokenCount === tokens.length) {
    score += weights.allTokensBonus;
    maybePushReason(reasons, explain, "bonus:all-tokens");
  }

  if (includeRecencyBonus) {
    const recencyBonus = getRecencyBonus(entry.note.mtime);
    if (recencyBonus > 0) {
      score += recencyBonus;
      maybePushReason(reasons, explain, `bonus:recent+${recencyBonus}`);
    }
  }

  return {
    score,
    matchedTokenCount,
    reasons: [...new Set(reasons)],
    entry: buildResultEntry(entry.note, tokens),
  };
}

function scoreEntryHybridBm25(
  entry: SearchEntry,
  tokens: string[],
  index: SearchIndexSnapshot,
  weights: SearchWeights,
  bm25: Bm25Options,
  includeRecencyBonus: boolean,
  explain: boolean,
): StructuredSearchResult {
  let score = 0;
  let matchedTokenCount = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    let tokenMatched = false;
    const tagToken = token.startsWith("#") ? token : `#${token}`;

    if (entry.normalizedTags.includes(tagToken)) {
      score += weights.tagExact;
      maybePushReason(reasons, explain, `tag:${tagToken}`);
      tokenMatched = true;
    }

    if (entry.normalizedFilename.includes(token) || entry.normalizedTitle.includes(token)) {
      score += weights.filenameMatch;
      maybePushReason(reasons, explain, `filename:${token}`);
      tokenMatched = true;
    }

    if (!entry.normalizedTags.includes(tagToken) && entry.tagText.includes(token)) {
      score += weights.tagPartial;
      maybePushReason(reasons, explain, `tag-partial:${token}`);
      tokenMatched = true;
    }

    const contentScore = bm25ContentScore(entry, token, index, bm25) * weights.contentMatch;
    if (contentScore > 0) {
      score += contentScore;
      maybePushReason(reasons, explain, `bm25:content:${token}`);
      tokenMatched = true;
    }

    if (tokenMatched) matchedTokenCount += 1;
  }

  if (matchedTokenCount >= 2) {
    score += weights.multiTokenBonus;
    maybePushReason(reasons, explain, "bonus:multi-token");
  }

  if (tokens.length > 0 && matchedTokenCount === tokens.length) {
    score += weights.allTokensBonus;
    maybePushReason(reasons, explain, "bonus:all-tokens");
  }

  if (includeRecencyBonus) {
    const recencyBonus = getRecencyBonus(entry.note.mtime);
    if (recencyBonus > 0) {
      score += recencyBonus;
      maybePushReason(reasons, explain, `bonus:recent+${recencyBonus}`);
    }
  }

  return {
    score,
    matchedTokenCount,
    reasons: [...new Set(reasons)],
    entry: buildResultEntry(entry.note, tokens),
  };
}

export function resolveSearchStrategy(
  strategy: SearchStrategy | undefined,
  queryTokens: string[],
  index: SearchIndexSnapshot,
  bm25: Bm25Options,
): Exclude<SearchStrategy, "auto"> {
  if (strategy === "classic" || strategy === "hybrid_bm25") return strategy;

  const hasOnlyTagTokens = queryTokens.length > 0 && queryTokens.every((token) => token.startsWith("#"));
  if (hasOnlyTagTokens) return "classic";
  if (index.entries.length < bm25.minDocumentCountForAuto) return "classic";
  if (queryTokens.length >= bm25.minQueryTokensForAuto) return "hybrid_bm25";
  if (queryTokens.join("").length >= 8) return "hybrid_bm25";
  return "classic";
}

export function executeStructuredSearch(
  index: SearchIndexSnapshot,
  request: StructuredSearchRequest,
): StructuredSearchResponse | { error: string } {
  const queryTokens = tokenizeQuery(request.query);
  if (queryTokens.length === 0) {
    return { error: "query is empty" };
  }

  const safeLimit = toBoundedInt(request.limit ?? 10, 10, 1, 200);
  const includeRecencyBonus = request.include_recency_bonus ?? true;
  const explain = request.explain ?? true;
  const synonymMap = buildSynonymMap(request.synonyms);
  const expandedTokens = expandTokens(queryTokens, synonymMap);
  const weights = getEffectiveWeights(request.weights);
  const bm25 = getEffectiveBm25Options(request.bm25);
  const appliedStrategy = resolveSearchStrategy(request.search_strategy, queryTokens, index, bm25);

  const ranked = index.entries
    .map((entry) => (
      appliedStrategy === "classic"
        ? scoreEntryClassic(entry, expandedTokens, weights, includeRecencyBonus, explain)
        : scoreEntryHybridBm25(entry, expandedTokens, index, weights, bm25, includeRecencyBonus, explain)
    ))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.mtime - left.entry.mtime)
    .slice(0, safeLimit);

  return {
    query: request.query,
    queryTokens,
    expandedTokens,
    totalMatches: ranked.length,
    appliedStrategy,
    results: ranked,
  };
}

export function noteMatchesDateRange(entry: NoteEntry, from?: string, to?: string): boolean {
  const dateValue = entry.createdAt ?? new Date(entry.mtime).toISOString().slice(0, 10);
  const noteDate = dateValue.slice(0, 10);
  if (from && noteDate < from) return false;
  if (to && noteDate > to) return false;
  return true;
}

export function readNoteEntries(notesDir: string): NoteEntry[] {
  return getSearchIndexNotes(getCachedSearchIndex(notesDir));
}