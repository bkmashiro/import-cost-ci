import { type ImportResult } from './formatter.js';
interface PullRequestRef {
    owner: string;
    repo: string;
    issueNumber: number;
}
export declare function parsePullRequestRef(): PullRequestRef | null;
declare function buildCommentBody(results: ImportResult[], limit: number): string;
export declare function maybePostGitHubComment(results: ImportResult[], limit: number): Promise<void>;
export { buildCommentBody };
