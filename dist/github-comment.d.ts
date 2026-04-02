import { type ImportResult } from './formatter.js';
declare function buildCommentBody(results: ImportResult[], limit: number): string;
export declare function maybePostGitHubComment(results: ImportResult[], limit: number): Promise<void>;
export { buildCommentBody };
