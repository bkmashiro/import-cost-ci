import chalk from 'chalk'

export interface ImportResult {
  pkg: string
  bytes: number
  exceeded: boolean
}

const TREEMAP_WIDTH = 20

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

/**
 * Formats a byte count as a human-readable size string.
 *
 * Values below 1024 are formatted as bytes (e.g. `"512 B"`).
 * Values 1024 and above are formatted as kilobytes with one decimal place
 * (e.g. `"1.5 kB"`).
 *
 * @param bytes - Non-negative number of bytes to format.
 * @returns A human-readable string representation of the size.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
}

function sortResultsBySize(results: ImportResult[]): ImportResult[] {
  return [...results].sort((left, right) => right.bytes - left.bytes || left.pkg.localeCompare(right.pkg))
}

function buildTreemapBar(bytes: number, totalBytes: number): string {
  if (totalBytes <= 0) {
    return '░'.repeat(TREEMAP_WIDTH)
  }

  const filled = Math.min(TREEMAP_WIDTH, Math.round((bytes / totalBytes) * TREEMAP_WIDTH))
  return `${'█'.repeat(filled)}${'░'.repeat(TREEMAP_WIDTH - filled)}`
}

/**
 * Builds a one-line summary describing whether any imports exceeded the size limit.
 *
 * @param violations - The number of imports that exceeded the limit.
 * @param limit - The size limit in bytes used for comparison.
 * @returns A human-readable summary string.
 *   - `"All imports are within the X limit."` when `violations === 0`.
 *   - `"N import(s) exceeded the X limit."` otherwise.
 */
export function buildSummaryLine(violations: number, limit: number): string {
  if (violations === 0) {
    return `All imports are within the ${formatSize(limit)} limit.`
  }

  return `${violations} import(s) exceeded the ${formatSize(limit)} limit.`
}

/**
 * Renders import analysis results as a Markdown report.
 *
 * Produces a GitHub-flavored Markdown table with columns for package name,
 * size, and status (OK / Exceeded), followed by a summary line. Pipe
 * characters in package names are escaped so the table renders correctly.
 *
 * @param results - The list of import measurements to render.
 * @param limit - The size limit in bytes used to determine the exceeded status.
 * @returns A Markdown string suitable for posting as a GitHub PR comment.
 */
export function formatResultsMarkdown(results: ImportResult[], limit: number): string {
  const lines = [
    '## import-cost-ci report',
    '',
    `Limit: \`${formatSize(limit)}\``,
    '',
    '| Package | Size | Status |',
    '| --- | ---: | --- |',
    ...results.map((result) => {
      const status = result.exceeded ? 'Exceeded' : 'OK'
      return `| \`${escapeMarkdownCell(result.pkg)}\` | ${formatSize(result.bytes)} | ${status} |`
    }),
    '',
    buildSummaryLine(results.filter((result) => result.exceeded).length, limit),
  ]

  return lines.join('\n')
}

/**
 * Renders a text-based treemap showing the relative size of each import.
 *
 * Results are sorted by size descending. The top 10 packages are shown
 * individually; any remaining packages are collapsed into a single
 * `[other N pkgs]` row. Each row includes a proportional bar, the formatted
 * size, and the percentage of the total.
 *
 * @param results - The list of import measurements to visualize.
 * @returns A multi-line string containing the treemap display.
 */
export function formatTreemap(results: ImportResult[]): string {
  const sorted = sortResultsBySize(results)
  const totalBytes = sorted.reduce((sum, result) => sum + result.bytes, 0)
  const topResults = sorted.slice(0, 10)
  const remaining = sorted.slice(10)

  const treemapRows = topResults.map((result) => ({
    label: result.pkg,
    bytes: result.bytes,
  }))

  if (remaining.length > 0) {
    treemapRows.push({
      label: `[other ${remaining.length} pkgs]`,
      bytes: remaining.reduce((sum, result) => sum + result.bytes, 0),
    })
  }

  const labelWidth = treemapRows.reduce((max, row) => Math.max(max, row.label.length), 0)

  return [
    `Import size breakdown (total: ${formatSize(totalBytes)}):`,
    '',
    ...treemapRows.map((row) => {
      const percentage = totalBytes === 0 ? 0 : Math.round((row.bytes / totalBytes) * 100)
      return `${row.label.padEnd(labelWidth)}  ${buildTreemapBar(row.bytes, totalBytes)}  ${formatSize(row.bytes).padStart(7)}  (${percentage}%)`
    }),
  ].join('\n')
}

/**
 * Prints a color-coded import size report to stdout.
 *
 * Each package is printed on its own line with a green checkmark if within
 * the limit, or a red cross and a warning note if the limit is exceeded.
 * Uses `chalk` for terminal color support.
 *
 * @param results - The list of import measurements to display.
 * @param limit - The size limit in bytes used to determine the exceeded status.
 */
export function printResults(results: ImportResult[], limit: number): void {
  for (const r of results) {
    const sizeStr = formatSize(r.bytes)
    const limitStr = formatSize(limit)
    if (r.exceeded) {
      console.log(
        `${chalk.red('✗')} ${chalk.bold(r.pkg.padEnd(20))} ${chalk.red(sizeStr)}  ← exceeds ${limitStr} limit!`
      )
    } else {
      console.log(
        `${chalk.green('✓')} ${chalk.bold(r.pkg.padEnd(20))} ${chalk.green(sizeStr)}`
      )
    }
  }
}

/**
 * Prints the text-based treemap visualization to stdout.
 *
 * Delegates to {@link formatTreemap} for rendering, then writes the result
 * via `console.log`.
 *
 * @param results - The list of import measurements to visualize.
 */
export function printTreemap(results: ImportResult[]): void {
  console.log(formatTreemap(results))
}

/**
 * Prints import analysis results to stdout as a formatted JSON object.
 *
 * The output includes the configured limit, a per-package breakdown with
 * both raw bytes and a human-readable size, the total violation count, and
 * a plain-text summary line. The JSON is indented with 2 spaces.
 *
 * @param results - The list of import measurements to serialize.
 * @param limit - The size limit in bytes included in the JSON output.
 */
export function printJsonResults(results: ImportResult[], limit: number): void {
  const violations = results.filter((r) => r.exceeded).length

  console.log(
    JSON.stringify(
      {
        limit,
        results: results.map((r) => ({
          pkg: r.pkg,
          bytes: r.bytes,
          size: formatSize(r.bytes),
          exceeded: r.exceeded,
        })),
        violations,
        summary: buildSummaryLine(violations, limit),
      },
      null,
      2
    )
  )
}
