import { type ImportResult } from './formatter.js';
export interface HistoryPackageEntry {
    name: string;
    size: number;
}
export interface HistoryEntry {
    date: string;
    totalSize: number;
    packages: HistoryPackageEntry[];
}
export declare function getHistoryFilePath(cwd?: string): string;
export declare function loadHistory(cwd?: string): HistoryEntry[];
export declare function buildHistoryEntry(results: ImportResult[], date?: string): HistoryEntry;
export declare function saveHistoryEntry(results: ImportResult[], cwd?: string, date?: string): HistoryEntry[];
export declare function formatHistoryReport(entries: HistoryEntry[]): string;
export declare function shouldAutoEnableHistory(): boolean;
