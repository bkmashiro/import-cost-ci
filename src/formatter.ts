import chalk from 'chalk'

export interface ImportResult {
  pkg: string
  bytes: number
  exceeded: boolean
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
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
        violations: results.filter((r) => r.exceeded).length,
      },
      null,
      2
    )
  )
}
