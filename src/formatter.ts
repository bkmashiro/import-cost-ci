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

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
}

export function sortResultsBySize(results: ImportResult[]): ImportResult[] {
  return [...results].sort((left, right) => right.bytes - left.bytes || left.pkg.localeCompare(right.pkg))
}

export function buildTreemapBar(bytes: number, totalBytes: number): string {
  if (totalBytes <= 0) {
    return '░'.repeat(TREEMAP_WIDTH)
  }

  const filled = Math.min(TREEMAP_WIDTH, Math.round((bytes / totalBytes) * TREEMAP_WIDTH))
  return `${'█'.repeat(filled)}${'░'.repeat(TREEMAP_WIDTH - filled)}`
}

export function buildSummaryLine(violations: number, limit: number): string {
  if (violations === 0) {
    return `All imports are within the ${formatSize(limit)} limit.`
  }

  return `${violations} import(s) exceeded the ${formatSize(limit)} limit.`
}

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

export function printTreemap(results: ImportResult[]): void {
  console.log(formatTreemap(results))
}

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
