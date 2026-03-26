import * as vscode from "vscode";
import type { DashTask } from "./dashboardPanel.js";

export type TaskCategory = "work" | "personal" | "health" | "learning" | "admin" | "other";

export interface ExtractedTask {
  text: string;
  category: TaskCategory;
  priority: "high" | "medium" | "low";
  timeEstimateMin: number;
  dueDate?: string | null;
}

export interface DayPlanItem {
  text: string;
  priority: "high" | "medium" | "low";
  reason: string;
  timeEstimateMin: number;
}

export interface DayPlan {
  summary: string;
  estimatedHours: number;
  items: DayPlanItem[];
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

async function getModel(): Promise<vscode.LanguageModelChat | null> {
  try {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    return models[0] ?? null;
  } catch {
    return null;
  }
}

export async function extractTasksFromMoments(
  text: string,
  token: vscode.CancellationToken,
): Promise<ExtractedTask[]> {
  const model = await getModel();
  if (!model) return [];

  const prompt = `以下は日常のつぶやき・日記テキストです。\
実行可能なタスク・アクションアイテムのみを JSON 配列で抽出してください。\
挨拶、感想、感情表現のみの文は無視してください。

各タスクは以下のフィールドを持つオブジェクトにしてください:
- "text": タスク内容（簡潔に、動詞で始める）
- "category": "work" | "personal" | "health" | "learning" | "admin" のいずれか
- "priority": "high" | "medium" | "low" のいずれか
- "timeEstimateMin": 所要時間の見積もり（分、整数）
- "dueDate": テキスト中に @YYYY-MM-DD / 📅YYYY-MM-DD / due:YYYY-MM-DD 形式の日付があれば "YYYY-MM-DD" 文字列、なければ null

JSON 配列のみ返してください。説明文は不要です。

テキスト:
${text}`;

  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      token,
    );
    let raw = "";
    for await (const chunk of response.text) {
      raw += chunk;
    }
    const parsed = JSON.parse(stripJsonFences(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ExtractedTask[];
  } catch {
    return [];
  }
}

export async function planDay(
  date: string,
  tasks: DashTask[],
  token: vscode.CancellationToken,
): Promise<DayPlan | null> {
  const model = await getModel();
  if (!model) return null;

  if (tasks.length === 0)
    return { summary: "今日のタスクはありません。", estimatedHours: 0, items: [] };

  const taskList = tasks
    .map(
      (t, i) =>
        `${i + 1}. ${t.text}${t.dueDate ? ` @${t.dueDate}` : ""}${t.tags.length ? " " + t.tags.join(" ") : ""}`,
    )
    .join("\n");

  const prompt = `今日 (${date}) のタスクリストを優先順位の高い順に並べ替えてください。

【厳守ルール】
- 以下のタスクリストにあるタスクのみを返すこと
- 「メール確認」「休憩」「振り返り」などリストにないタスクを絶対に追加しないこと
- 各タスクに「優先する理由」と「現実的な所要時間（分）」を付けること

タスクリスト:
${taskList}

以下の JSON 形式のみ返してください（説明文なし）:
{
  "summary": "今日の作業量の一言コメント（例：軽めの一日 / ボリュームあり）",
  "estimatedHours": 3.5,
  "items": [
    { "text": "タスクの元のテキスト", "priority": "high", "reason": "優先する理由（1行）", "timeEstimateMin": 90 }
  ]
}`;

  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      token,
    );
    let raw = "";
    for await (const chunk of response.text) {
      raw += chunk;
    }
    const parsed = JSON.parse(stripJsonFences(raw)) as DayPlan;
    return parsed;
  } catch {
    return null;
  }
}
