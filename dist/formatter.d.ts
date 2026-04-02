export interface ImportResult {
    pkg: string;
    bytes: number;
    exceeded: boolean;
}
export declare function formatSize(bytes: number): string;
export declare function buildSummaryLine(violations: number, limit: number): string;
export declare function formatResultsMarkdown(results: ImportResult[], limit: number): string;
export declare function formatTreemap(results: ImportResult[]): string;
export declare function printResults(results: ImportResult[], limit: number): void;
export declare function printTreemap(results: ImportResult[]): void;
export declare function printJsonResults(results: ImportResult[], limit: number): void;
