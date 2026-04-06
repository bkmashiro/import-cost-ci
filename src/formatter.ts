import chalk from 'chalk'

export interface ImportResult {
  pkg: string
  bytes: number
  exceeded: boolean
}

const TREEMAP_WIDTH = 20

export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

/**
 * Converts a byte count into a human-readable size string.
 *
 * Values below 1 kB are returned as `"N B"`; larger values are shown in
 * kilobytes with one decimal place, e.g. `"12.3 kB"`.
 *
 * @param bytes - Non-negative number of bytes to format.
 * @returns A formatted size string such as `"512 B"` or `"4.2 kB"`.
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
 * Builds a one-line human-readable summary of the import-size check outcome.
 *
 * @param violations - Number of packages that exceeded the size limit.
 * @param limit - The size limit in bytes that was applied.
 * @returns A sentence such as `"All imports are within the 50 kB limit."` or
 *   `"3 import(s) exceeded the 50 kB limit."`.
 */
export function buildSummaryLine(violations: number, limit: number): string {
  if (violations === 0) {
    return `All imports are within the ${formatSize(limit)} limit.`
  }

  return `${violations} import(s) exceeded the ${formatSize(limit)} limit.`
}

/**
 * Renders import-size results as a Markdown report suitable for GitHub PR comments.
 *
 * The output includes a heading, the configured size limit, a table with one row
 * per package showing its name, gzip size, and pass/fail status, and a summary
 * sentence at the end.
 *
 * @param results - Array of import measurement results to render.
 * @param limit - The size limit in bytes used to determine pass/fail status.
 * @returns A multi-line Markdown string.
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
 * Renders a plain-text treemap visualising the relative size of each import.
 *
 * Packages are sorted by size descending. The top 10 are shown individually;
 * any remainder is collapsed into a single `[other N pkgs]` row. Each row
 * contains a proportional bar made of Unicode block characters, the formatted
 * size, and the percentage of the total.
 *
 * @param results - Array of import measurement results to visualise.
 * @returns A multi-line plain-text string ready to print to a terminal.
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
 * Prints a coloured per-package size report to stdout.
 *
 * Each line shows a green tick (pass) or red cross (fail), the package name,
 * its gzip size, and — for failures — the limit that was exceeded.
 *
 * @param results - Array of import measurement results to print.
 * @param limit - The size limit in bytes, shown next to any failing package.
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
 * Prints the plain-text treemap visualisation to stdout.
 *
 * @param results - Array of import measurement results to visualise.
 */
export function printTreemap(results: ImportResult[]): void {
  console.log(formatTreemap(results))
}

/**
 * Prints the full results as a formatted JSON object to stdout.
 *
 * The object includes the limit, a results array with human-readable sizes,
 * a violation count, and a summary sentence — making it easy to consume
 * programmatically from shell scripts or CI tooling.
 *
 * @param results - Array of import measurement results to serialise.
 * @param limit - The size limit in bytes included in the output object.
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
