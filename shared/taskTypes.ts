/** Core task fields used by the extension dashboard and task views. */
export interface BaseTask {
  id: string;
  filePath: string;
  lineIndex: number;
  text: string;
  done: boolean;
  date: string | null;
  tags: string[];
}
