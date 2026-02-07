import * as vscode from "vscode";
import { MemoryEntry, parseMemoryFile } from "./searchCommand";

interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
  reasons: string[];
  matchedTokenCount: number;
}

interface SearchWeights {
  tagExact: number;
  dateMatch: number;
  monthMatch: number;
  tagPartial: number;
  contentMatch: number;
  multiTokenBonus: number;
  allTokensBonus: number;
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => normalize(token))
    .filter((token) => token.length > 0);
}

function toBoundedInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function getSearchWeights(): SearchWeights {
  const config = vscode.workspace.getConfiguration("notes");

  return {
    tagExact: toBoundedInt(config.get<number>("structureSearchWeightTagExact", 6), 6, 1, 20),
    dateMatch: toBoundedInt(config.get<number>("structureSearchWeightDate", 4), 4, 1, 20),
    monthMatch: toBoundedInt(config.get<number>("structureSearchWeightMonth", 3), 3, 1, 20),
    tagPartial: toBoundedInt(config.get<number>("structureSearchWeightTagPartial", 3), 3, 1, 20),
    contentMatch: toBoundedInt(config.get<number>("structureSearchWeightContent", 2), 2, 1, 20),
    multiTokenBonus: toBoundedInt(config.get<number>("structureSearchBonusMultiToken", 3), 3, 0, 20),
    allTokensBonus: toBoundedInt(config.get<number>("structureSearchBonusAllTokens", 4), 4, 0, 20),
  };
}

function getSynonymMap(): Map<string, string[]> {
  const builtInPairs: Array<[string, string[]]> = [
    ["経費", ["精算", "交通費", "出張費"]],
    ["会議", ["mtg", "ミーティング"]],
    ["タスク", ["todo", "課題"]],
  ];

  const config = vscode.workspace.getConfiguration("notes");
  const custom = config.get<string[]>("structureSearchSynonyms", []);
  const map = new Map<string, Set<string>>();

  for (const [key, values] of builtInPairs) {
    const normalizedKey = normalize(key);
    if (!map.has(normalizedKey)) {
      map.set(normalizedKey, new Set<string>());
    }
    values.forEach((v) => map.get(normalizedKey)?.add(normalize(v)));
  }

  for (const row of custom) {
    const [rawKey, rawValues] = row.split(":").map((s) => s.trim());
    if (!rawKey || !rawValues) {
      continue;
    }

    const key = normalize(rawKey);
    if (!map.has(key)) {
      map.set(key, new Set<string>());
    }

    rawValues
      .split(",")
      .map((v) => normalize(v.trim()))
      .filter((v) => v.length > 0)
      .forEach((v) => map.get(key)?.add(v));
  }

  return new Map([...map.entries()].map(([k, v]) => [k, [...v]]));
}

function expandTokens(tokens: string[], synonymMap: Map<string, string[]>): string[] {
  const expanded = new Set(tokens);

  for (const token of tokens) {
    const bareToken = token.startsWith("#") ? token.slice(1) : token;
    const synonyms = synonymMap.get(bareToken) || [];
    synonyms.forEach((syn) => expanded.add(syn));
  }

  return [...expanded];
}

function parseEntryDate(dateTime: string): Date | null {
  const isoLike = dateTime.includes(" ") ? dateTime.replace(" ", "T") : `${dateTime}T00:00`;
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getRecencyBonus(dateTime: string): number {
  const parsed = parseEntryDate(dateTime);
  if (!parsed) {
    return 0;
  }

  const now = new Date();
  const days = (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24);

  if (days <= 7) {
    return 4;
  }
  if (days <= 30) {
    return 3;
  }
  if (days <= 90) {
    return 2;
  }
  if (days <= 180) {
    return 1;
  }

  return 0;
}

function scoreEntry(entry: MemoryEntry, tokens: string[], weights: SearchWeights): ScoredEntry {
  const dateText = normalize(entry.dateTime);
  const normalizedTags = entry.tags.map((tag) => normalize(tag));
  const tagText = normalizedTags.join(" ");
  const contentText = normalize(entry.content);
  const monthText = entry.dateTime.slice(0, 7);

  let score = 0;
  const reasons: string[] = [];
  let matchedTokenCount = 0;

  for (const token of tokens) {
    let tokenMatched = false;
    const tagToken = token.startsWith("#") ? token : `#${token}`;

    if (normalizedTags.includes(tagToken)) {
      score += weights.tagExact;
      reasons.push(`🎯 tag exact: ${tagToken}`);
      tokenMatched = true;
      continue;
    }

    if (dateText.includes(token)) {
      score += weights.dateMatch;
      reasons.push(`📅 date: ${token}`);
      tokenMatched = true;
    }

    if (monthText.includes(token)) {
      score += weights.monthMatch;
      reasons.push(`🗓 month: ${token}`);
      tokenMatched = true;
    }

    if (tagText.includes(token)) {
      score += weights.tagPartial;
      reasons.push(`🏷 tag partial: ${token}`);
      tokenMatched = true;
    }

    if (contentText.includes(token)) {
      score += weights.contentMatch;
      reasons.push(`📝 content: ${token}`);
      tokenMatched = true;
    }

    if (tokenMatched) {
      matchedTokenCount += 1;
    }
  }

  if (matchedTokenCount >= 2) {
    score += weights.multiTokenBonus;
    reasons.push("🔗 multi-token match");
  }

  if (matchedTokenCount === tokens.length) {
    score += weights.allTokensBonus;
    reasons.push("✅ all tokens matched");
  }

  const recencyBonus = getRecencyBonus(entry.dateTime);
  if (recencyBonus > 0) {
    score += recencyBonus;
    reasons.push(`⏱ recent +${recencyBonus}`);
  }

  return { entry, score, reasons, matchedTokenCount };
}

function createResultItem(scored: ScoredEntry): vscode.QuickPickItem {
  const preview = scored.entry.content.substring(0, 80).replace(/\n/g, " ");
  const reasons = [...new Set(scored.reasons)].slice(0, 2).join(" / ");

  return {
    label: `${scored.entry.dateTime} ${scored.entry.tags.join(" ")}`,
    description: `score:${scored.score} matched:${scored.matchedTokenCount} | ${preview}`,
    detail: `${reasons || "matched by context"} | Line ${scored.entry.line + 1}`,
  };
}

function getMaxResults(): number {
  const config = vscode.workspace.getConfiguration("notes");
  const configured = config.get<number>("structureSearchMaxResults", 50);
  if (!Number.isFinite(configured)) {
    return 50;
  }
  return Math.min(Math.max(Math.floor(configured), 10), 200);
}

export async function showStructureSearch(memoryPath: string): Promise<void> {
  const entries = parseMemoryFile(memoryPath);

  if (entries.length === 0) {
    vscode.window.showInformationMessage("No entries found in memory.");
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: "Structure Search: query by tag, date, month, or keyword",
    placeHolder: "例: #todo 2026-02 経費",
  });

  if (!query) {
    return;
  }

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    vscode.window.showInformationMessage("Please enter at least one token.");
    return;
  }

  const synonymMap = getSynonymMap();
  const expandedTokens = expandTokens(tokens, synonymMap);
  const weights = getSearchWeights();

  const ranked = entries
    .map((entry) => scoreEntry(entry, expandedTokens, weights))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.dateTime.localeCompare(a.entry.dateTime));

  if (ranked.length === 0) {
    vscode.window.showInformationMessage("No relevant entries found.");
    return;
  }

  const topRanked = ranked.slice(0, getMaxResults());
  const items = topRanked.map((scored) => createResultItem(scored));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Structure Search: ${topRanked.length} result(s)`,
  });

  if (!selected) {
    return;
  }

  const lineNum = parseInt(selected.detail?.match(/Line (\d+)/)?.[1] || "1", 10) - 1;
  const doc = await vscode.workspace.openTextDocument(memoryPath);
  const editor = await vscode.window.showTextDocument(doc);
  const position = new vscode.Position(lineNum, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
