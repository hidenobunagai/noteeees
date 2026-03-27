import * as vscode from "vscode";

export type TaskCategory = "work" | "personal" | "health" | "learning" | "admin" | "other";

export interface ExtractedTask {
  text: string;
  category: TaskCategory;
  priority: "high" | "medium" | "low";
  timeEstimateMin: number;
  dueDate?: string | null;
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
  if (!model) {
    return [];
  }

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
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as ExtractedTask[];
  } catch {
    return [];
  }
}
