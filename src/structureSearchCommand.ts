import * as vscode from "vscode";
import { MemoryEntry, parseMemoryFile } from "./searchCommand";

interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
  reasons: string[];
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

function scoreEntry(entry: MemoryEntry, tokens: string[]): ScoredEntry {
  const dateText = normalize(entry.dateTime);
  const tagText = normalize(entry.tags.join(" "));
  const contentText = normalize(entry.content);
  const monthText = entry.dateTime.slice(0, 7);

  let score = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    const tagToken = token.startsWith("#") ? token : `#${token}`;

    if (entry.tags.map((tag) => normalize(tag)).includes(tagToken)) {
      score += 6;
      reasons.push(`tag:${tagToken}`);
      continue;
    }

    if (dateText.includes(token)) {
      score += 4;
      reasons.push(`date:${token}`);
    }

    if (monthText.includes(token)) {
      score += 3;
      reasons.push(`month:${token}`);
    }

    if (tagText.includes(token)) {
      score += 3;
      reasons.push(`tag-part:${token}`);
    }

    if (contentText.includes(token)) {
      score += 2;
      reasons.push(`content:${token}`);
    }
  }

  return { entry, score, reasons };
}

function createResultItem(scored: ScoredEntry): vscode.QuickPickItem {
  const preview = scored.entry.content.substring(0, 80).replace(/\n/g, " ");
  const reasons = [...new Set(scored.reasons)].slice(0, 3).join(", ");

  return {
    label: `${scored.entry.dateTime} ${scored.entry.tags.join(" ")}`,
    description: `score: ${scored.score} | ${preview}`,
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

  const ranked = entries
    .map((entry) => scoreEntry(entry, tokens))
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
