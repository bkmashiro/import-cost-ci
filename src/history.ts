import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatSize, type ImportResult } from './formatter.js'

const HISTORY_FILE = '.import-cost-history.json'
const MAX_HISTORY_ENTRIES = 30
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

export interface HistoryPackageEntry {
  name: string
  size: number
}

export interface HistoryEntry {
  date: string
  totalSize: number
  packages: HistoryPackageEntry[]
}

interface HistoryFileShape {
  entries: HistoryEntry[]
}

/**
 * Returns the absolute path to the history JSON file for a given working directory.
 *
 * @param cwd - Directory to resolve the history file against. Defaults to `process.cwd()`.
 * @returns Absolute path to `.import-cost-history.json` inside `cwd`.
 */
export function getHistoryFilePath(cwd = process.cwd()): string {
  return join(cwd, HISTORY_FILE)
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function isValidDate(dateString: string): boolean {
  return !Number.isNaN(Date.parse(dateString))
}

function sanitizeHistoryEntry(entry: Partial<HistoryEntry> | null | undefined): HistoryEntry | null {
  if (!entry || typeof entry.date !== 'string' || typeof entry.totalSize !== 'number' || !Array.isArray(entry.packages)) {
    return null
  }

  if (!isValidDate(entry.date)) {
    return null
  }

  const packages = entry.packages
    .filter(
      (pkg): pkg is HistoryPackageEntry =>
        Boolean(pkg) && typeof pkg.name === 'string' && typeof pkg.size === 'number'
    )
    .map((pkg) => ({ name: pkg.name, size: pkg.size }))

  return {
    date: entry.date,
    totalSize: entry.totalSize,
    packages,
  }
}

/**
 * Reads and parses the import-cost history file from disk.
 *
 * Returns an empty array when the file does not exist, cannot be parsed, or
 * contains no valid entries. Invalid individual entries are silently dropped.
 * The result is capped at the most recent 30 entries.
 *
 * @param cwd - Directory that contains (or will contain) the history file.
 *   Defaults to `process.cwd()`.
 * @returns Array of valid {@link HistoryEntry} objects, newest first.
 */
export function loadHistory(cwd = process.cwd()): HistoryEntry[] {
  const historyPath = getHistoryFilePath(cwd)
  if (!existsSync(historyPath)) {
    return []
  }

  try {
    const parsed = JSON.parse(readFileSync(historyPath, 'utf8')) as Partial<HistoryFileShape> | HistoryEntry[]
    const entries = Array.isArray(parsed) ? parsed : parsed.entries
    if (!Array.isArray(entries)) {
      return []
    }

    return entries
      .map((entry) => sanitizeHistoryEntry(entry))
      .filter((entry): entry is HistoryEntry => entry !== null)
      .slice(0, MAX_HISTORY_ENTRIES)
  } catch {
    return []
  }
}

/**
 * Constructs a {@link HistoryEntry} from a set of import measurement results.
 *
 * Packages are sorted by size descending (then alphabetically) so that the
 * entry is stable and the largest packages appear first.
 *
 * @param results - Import measurement results for the current run.
 * @param date - ISO date string (`YYYY-MM-DD`) to stamp the entry with.
 *   Defaults to today's date.
 * @returns A new history entry representing this run's totals and per-package sizes.
 */
export function buildHistoryEntry(results: ImportResult[], date = getTodayDate()): HistoryEntry {
  const sortedPackages = [...results]
    .sort((left, right) => right.bytes - left.bytes || left.pkg.localeCompare(right.pkg))
    .map((result) => ({ name: result.pkg, size: result.bytes }))

  return {
    date,
    totalSize: results.reduce((sum, result) => sum + result.bytes, 0),
    packages: sortedPackages,
  }
}

/**
 * Prepends a new history entry for the current run and writes the updated history to disk.
 *
 * The new entry is built from `results`, prepended to any existing history, and the
 * combined list is truncated to 30 entries before being written as JSON.
 *
 * @param results - Import measurement results for the current run.
 * @param cwd - Directory that contains (or will contain) the history file.
 *   Defaults to `process.cwd()`.
 * @param date - ISO date string (`YYYY-MM-DD`) to stamp the new entry with.
 *   Defaults to today's date.
 * @returns The updated array of history entries (newest first), as written to disk.
 */
export function saveHistoryEntry(results: ImportResult[], cwd = process.cwd(), date = getTodayDate()): HistoryEntry[] {
  const historyPath = getHistoryFilePath(cwd)
  const nextEntry = buildHistoryEntry(results, date)
  const existingEntries = loadHistory(cwd)
  const entries = [nextEntry, ...existingEntries].slice(0, MAX_HISTORY_ENTRIES)

  writeFileSync(historyPath, JSON.stringify({ entries }, null, 2) + '\n')

  return entries
}

function formatSignedKb(bytes: number): string {
  const kb = bytes / 1024
  const rounded = Math.round(Math.abs(kb) * 10) / 10
  const sign = bytes >= 0 ? '+' : '-'

  if (Number.isInteger(rounded)) {
    return `${sign}${rounded.toFixed(0)}kb`
  }

  return `${sign}${rounded.toFixed(1)}kb`
}

function describeTrend(bytesPerWeek: number): string {
  if (Math.abs(bytesPerWeek) < 1) {
    return 'stable'
  }

  return bytesPerWeek > 0 ? 'growing' : 'shrinking'
}

/**
 * Renders the import-size history as a plain-text report.
 *
 * The report shows the current total size, a chronological list of previous
 * runs with per-entry deltas, and a weekly trend computed by linear interpolation
 * between the oldest and newest entries.
 *
 * @param entries - History entries in newest-first order (as returned by {@link loadHistory}).
 * @returns A multi-line plain-text string suitable for CLI output.
 */
export function formatHistoryReport(entries: HistoryEntry[]): string {
  if (entries.length === 0) {
    return 'Current: 0 B\nHistory:\n  (no history yet)\n\nTrend: not enough data'
  }

  const [current, ...previousEntries] = entries
  const lines = [`Current: ${formatSize(current.totalSize)}`, 'History:']

  if (previousEntries.length === 0) {
    lines.push('  (no previous runs)')
    lines.push('')
    lines.push('Trend: not enough data')
    return lines.join('\n')
  }

  previousEntries.forEach((entry, index) => {
    const newerEntry = index === 0 ? current : previousEntries[index - 1]
    const delta = newerEntry.totalSize - entry.totalSize
    const direction = delta > 0 ? '▲' : delta < 0 ? '▼' : '•'
    const deltaText = delta === 0 ? '' : `  ${direction} ${formatSignedKb(delta)}`
    lines.push(`  ${entry.date}  ${formatSize(entry.totalSize)}${deltaText}`)
  })

  lines.push('')

  const oldest = entries[entries.length - 1]
  const spanDays = Math.max(
    0,
    Math.round((Date.parse(current.date) - Date.parse(oldest.date)) / MILLIS_PER_DAY)
  )

  if (spanDays === 0) {
    lines.push('Trend: not enough data')
    return lines.join('\n')
  }

  const bytesPerWeek = ((current.totalSize - oldest.totalSize) / spanDays) * 7
  lines.push(`Trend: ${formatSignedKb(bytesPerWeek)}/week (${describeTrend(bytesPerWeek)})`)
  return lines.join('\n')
}

/**
 * Detects whether history tracking should be enabled automatically based on the
 * current GitHub Actions environment.
 *
 * Returns `true` only when the workflow is triggered by a `push` event targeting
 * the `main` branch (`refs/heads/main`). This prevents history from accumulating
 * on pull-request or other transient runs.
 *
 * @returns `true` if the current environment is a push to `main`, `false` otherwise.
 */
export function shouldAutoEnableHistory(): boolean {
  if (process.env.GITHUB_EVENT_NAME !== 'push') {
    return false
  }

  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath || !existsSync(eventPath)) {
    return false
  }

  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { ref?: string }
    return event.ref === 'refs/heads/main'
  } catch {
    return false
  }
}
