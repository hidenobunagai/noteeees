export declare const TASK_RE: RegExp;
export declare const TAG_RE: RegExp;
export declare const DUE_DATE_RE: RegExp;
export declare const DUE_DATE_TOKEN_RE: RegExp;

export declare function extractDueDate(text: string): string | null;
export declare function extractDueDateToken(text: string): string | null;
export declare function stripDueDateTokens(text: string): string;
