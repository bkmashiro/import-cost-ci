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
 * Returns the absolute path to the history JSON file.
 *
 * @param cwd - Directory in which to locate the file. Defaults to `process.cwd()`.
 * @returns Absolute path to `.import-cost-history.json` within `cwd`.
 */
export function getHistoryFilePath(cwd = process.cwd()): string {
  return join(cwd, HISTORY_FILE)
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function sanitizeHistoryEntry(entry: Partial<HistoryEntry> | null | undefined): HistoryEntry | null {
  if (!entry || typeof entry.date !== 'string' || typeof entry.totalSize !== 'number' || !Array.isArray(entry.packages)) {
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
 * Loads previously recorded history entries from disk.
 *
 * Reads `.import-cost-history.json` from `cwd`. Tolerates both the legacy
 * bare-array format and the current `{ entries: [...] }` envelope format.
 * Malformed entries are silently dropped. At most `MAX_HISTORY_ENTRIES` (30)
 * entries are returned.
 *
 * @param cwd - Directory to read history from. Defaults to `process.cwd()`.
 * @returns An array of valid {@link HistoryEntry} objects, most recent first.
 *   Returns an empty array when the file does not exist or cannot be parsed.
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
 * Constructs a {@link HistoryEntry} from the current run's results.
 *
 * Packages are sorted by size descending (then alphabetically) to produce a
 * stable, deterministic record. The total size is the sum of all package
 * sizes.
 *
 * @param results - The import measurements from the current run.
 * @param date - ISO date string (`YYYY-MM-DD`) for the entry. Defaults to today.
 * @returns A new {@link HistoryEntry} representing this run.
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
 * Appends a new history entry for the current run and persists the file.
 *
 * Prepends the new entry to the existing history and trims the list to at
 * most `MAX_HISTORY_ENTRIES` (30) entries before writing. The file is
 * written with 2-space indentation and a trailing newline.
 *
 * @param results - The import measurements from the current run.
 * @param cwd - Directory where the history file lives. Defaults to `process.cwd()`.
 * @param date - ISO date string (`YYYY-MM-DD`) for the entry. Defaults to today.
 * @returns The updated list of history entries as stored on disk.
 * @throws {Error} If the history file cannot be written.
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
 * Formats a multi-line history report comparing runs over time.
 *
 * The first entry is treated as the current (most recent) run. All subsequent
 * entries are listed with their date, size, and the delta relative to the
 * immediately newer run (indicated by `▲`, `▼`, or `•`). A trend line at the
 * end expresses the average weekly change across the full history span.
 *
 * @param entries - History entries in most-recent-first order.
 * @returns A formatted multi-line report string.
 *   - Returns a minimal "no history yet" message when `entries` is empty.
 *   - Returns a "not enough data" trend line when there is only one entry or
 *     all entries share the same date.
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
 * Determines whether history tracking should be enabled automatically.
 *
 * Returns `true` only when running in a GitHub Actions `push` event targeting
 * `refs/heads/main`. This prevents history accumulation on feature branches
 * or other CI triggers.
 *
 * @returns `true` if history should be auto-enabled; `false` otherwise.
 *   Returns `false` when:
 *   - `GITHUB_EVENT_NAME` is not `"push"`.
 *   - `GITHUB_EVENT_PATH` is missing or the file does not exist.
 *   - The event file cannot be parsed.
 *   - The push target ref is not `"refs/heads/main"`.
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
