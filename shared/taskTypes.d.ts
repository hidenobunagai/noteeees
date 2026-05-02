/** Core task fields shared between extension dashboard and MCP server. */
export interface BaseTask {
  id: string;
  filePath: string;
  lineIndex: number;
  text: string;
  done: boolean;
  date: string | null;
  tags: string[];
}
