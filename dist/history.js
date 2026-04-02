import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSize } from './formatter.js';
const HISTORY_FILE = '.import-cost-history.json';
const MAX_HISTORY_ENTRIES = 30;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
export function getHistoryFilePath(cwd = process.cwd()) {
    return join(cwd, HISTORY_FILE);
}
function getTodayDate() {
    return new Date().toISOString().slice(0, 10);
}
function sanitizeHistoryEntry(entry) {
    if (!entry || typeof entry.date !== 'string' || typeof entry.totalSize !== 'number' || !Array.isArray(entry.packages)) {
        return null;
    }
    const packages = entry.packages
        .filter((pkg) => Boolean(pkg) && typeof pkg.name === 'string' && typeof pkg.size === 'number')
        .map((pkg) => ({ name: pkg.name, size: pkg.size }));
    return {
        date: entry.date,
        totalSize: entry.totalSize,
        packages,
    };
}
export function loadHistory(cwd = process.cwd()) {
    const historyPath = getHistoryFilePath(cwd);
    if (!existsSync(historyPath)) {
        return [];
    }
    try {
        const parsed = JSON.parse(readFileSync(historyPath, 'utf8'));
        const entries = Array.isArray(parsed) ? parsed : parsed.entries;
        if (!Array.isArray(entries)) {
            return [];
        }
        return entries
            .map((entry) => sanitizeHistoryEntry(entry))
            .filter((entry) => entry !== null)
            .slice(0, MAX_HISTORY_ENTRIES);
    }
    catch {
        return [];
    }
}
export function buildHistoryEntry(results, date = getTodayDate()) {
    const sortedPackages = [...results]
        .sort((left, right) => right.bytes - left.bytes || left.pkg.localeCompare(right.pkg))
        .map((result) => ({ name: result.pkg, size: result.bytes }));
    return {
        date,
        totalSize: results.reduce((sum, result) => sum + result.bytes, 0),
        packages: sortedPackages,
    };
}
export function saveHistoryEntry(results, cwd = process.cwd(), date = getTodayDate()) {
    const historyPath = getHistoryFilePath(cwd);
    const nextEntry = buildHistoryEntry(results, date);
    const existingEntries = loadHistory(cwd);
    const entries = [nextEntry, ...existingEntries].slice(0, MAX_HISTORY_ENTRIES);
    writeFileSync(historyPath, JSON.stringify({ entries }, null, 2) + '\n');
    return entries;
}
function formatSignedKb(bytes) {
    const kb = bytes / 1024;
    const rounded = Math.round(Math.abs(kb) * 10) / 10;
    const sign = bytes >= 0 ? '+' : '-';
    if (Number.isInteger(rounded)) {
        return `${sign}${rounded.toFixed(0)}kb`;
    }
    return `${sign}${rounded.toFixed(1)}kb`;
}
function describeTrend(bytesPerWeek) {
    if (Math.abs(bytesPerWeek) < 1) {
        return 'stable';
    }
    return bytesPerWeek > 0 ? 'growing' : 'shrinking';
}
export function formatHistoryReport(entries) {
    if (entries.length === 0) {
        return 'Current: 0 B\nHistory:\n  (no history yet)\n\nTrend: not enough data';
    }
    const [current, ...previousEntries] = entries;
    const lines = [`Current: ${formatSize(current.totalSize)}`, 'History:'];
    if (previousEntries.length === 0) {
        lines.push('  (no previous runs)');
        lines.push('');
        lines.push('Trend: not enough data');
        return lines.join('\n');
    }
    previousEntries.forEach((entry, index) => {
        const newerEntry = index === 0 ? current : previousEntries[index - 1];
        const delta = newerEntry.totalSize - entry.totalSize;
        const direction = delta > 0 ? '▲' : delta < 0 ? '▼' : '•';
        const deltaText = delta === 0 ? '' : `  ${direction} ${formatSignedKb(delta)}`;
        lines.push(`  ${entry.date}  ${formatSize(entry.totalSize)}${deltaText}`);
    });
    lines.push('');
    const oldest = entries[entries.length - 1];
    const spanDays = Math.max(0, Math.round((Date.parse(current.date) - Date.parse(oldest.date)) / MILLIS_PER_DAY));
    if (spanDays === 0) {
        lines.push('Trend: not enough data');
        return lines.join('\n');
    }
    const bytesPerWeek = ((current.totalSize - oldest.totalSize) / spanDays) * 7;
    lines.push(`Trend: ${formatSignedKb(bytesPerWeek)}/week (${describeTrend(bytesPerWeek)})`);
    return lines.join('\n');
}
export function shouldAutoEnableHistory() {
    if (process.env.GITHUB_EVENT_NAME !== 'push') {
        return false;
    }
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || !existsSync(eventPath)) {
        return false;
    }
    try {
        const event = JSON.parse(readFileSync(eventPath, 'utf8'));
        return event.ref === 'refs/heads/main';
    }
    catch {
        return false;
    }
}
