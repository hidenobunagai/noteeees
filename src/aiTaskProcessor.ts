import * as vscode from "vscode";

export type TaskCategory = "work" | "personal" | "health" | "learning" | "admin" | "other";

export interface ExtractedTask {
  text: string;
  category: TaskCategory;
  priority: "high" | "medium" | "low";
  timeEstimateMin: number;
  dueDate?: string | null;
}

export interface NoteContent {
  filename: string;
  title: string;
  content: string;
  createdAt: string | null;
}

export interface McpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
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

export async function extractTasksFromText(
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

// Backward compatibility alias
export const extractTasksFromMoments = extractTasksFromText;

export async function aggregateNoteContents(
  mcpClient: McpClient,
  fromDate: string,
  toDate: string,
  token: vscode.CancellationToken,
): Promise<NoteContent[]> {
  const result = await mcpClient.callTool("get_notes_by_date", {
    from: fromDate,
    to: toDate,
    limit: 100,
  });

  const notes = JSON.parse(result.content[0].text) as Array<{
    filename: string;
    title: string;
    tags: string[];
    createdAt: string | null;
  }>;

  const contents: NoteContent[] = [];
  for (const note of notes) {
    if (token.isCancellationRequested) break;

    try {
      const contentResult = await mcpClient.callTool("get_note_content", {
        filename: note.filename,
      });
      contents.push({
        filename: note.filename,
        title: note.title,
        content: JSON.parse(contentResult.content[0].text) as string,
        createdAt: note.createdAt,
      });
    } catch (e) {
      console.warn(`Failed to fetch content for ${note.filename}:`, e);
    }
  }

  return contents;
}

export interface ExtractedTaskWithSource extends ExtractedTask {
  sourceNote: string;
}

export async function extractTasksFromNotes(
  noteContents: NoteContent[],
  token: vscode.CancellationToken,
): Promise<ExtractedTaskWithSource[]> {
  const allTasks: ExtractedTaskWithSource[] = [];

  for (const note of noteContents) {
    if (token.isCancellationRequested) break;

    const tasks = await extractTasksFromText(note.content, token);
    for (const task of tasks) {
      allTasks.push({
        ...task,
        sourceNote: note.filename,
      });
    }
  }

  return allTasks;
}
