import chalk from 'chalk'

export interface ImportResult {
  pkg: string
  bytes: number
  exceeded: boolean
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
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
