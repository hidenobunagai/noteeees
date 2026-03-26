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
  time: string;
  task: string;
  durationMin: number;
}

export interface DayPlan {
  summary: string;
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

  if (tasks.length === 0) return { summary: "タスクがありません。", items: [] };

  const taskList = tasks
    .map((t) => `- ${t.text}${t.tags.length ? " " + t.tags.join(" ") : ""}`)
    .join("\n");

  const prompt = `今日 (${date}) の以下のタスクリストから、現実的な一日の作業スケジュールを作成してください。
優先度・所要時間・カテゴリを考慮し、達成可能なプランにしてください。
作業時間帯の目安: 9:00〜18:00。休憩も含めてください。

タスクリスト:
${taskList}

以下の JSON 形式のみ返してください（説明文なし）:
{
  "summary": "今日のプランの一言サマリー（日本語）",
  "items": [
    { "time": "09:00", "task": "タスク名", "durationMin": 30 }
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
