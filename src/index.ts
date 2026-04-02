#!/usr/bin/env node
import { readFileSync } from 'fs'
import { program } from 'commander'
import { extractImports } from './parser.js'
import { measureImportSize } from './bundler.js'
import { printResults, printJsonResults, type ImportResult } from './formatter.js'

function parseLimit(raw: string): number {
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb)?$/i)
  if (!match) throw new Error(`Invalid size limit: ${raw}`)
  const value = parseFloat(match[1])
  const unit = (match[2] || 'b').toLowerCase()
  if (unit === 'kb') return Math.round(value * 1000)
  if (unit === 'mb') return Math.round(value * 1_000_000)
  return Math.round(value)
}

program
  .name('import-cost-ci')
  .description('Analyze bundle size cost of each import in a JS/TS file')
  .argument('<file>', 'Source file to analyze')
  .option('--limit <size>', 'Size limit (e.g. 50kb, 100kb)', '100kb')
  .option('--json', 'Output as JSON')
  .option('--no-fail', 'Do not exit 1 on violations (report only)')
  .option('--ignore <pkgs>', 'Comma-separated list of packages to ignore', '')
  .action(async (file: string, opts: { limit: string; json: boolean; fail: boolean; ignore: string }) => {
    let source: string
    try {
      source = readFileSync(file, 'utf-8')
    } catch {
      console.error(`Error: cannot read file "${file}"`)
      process.exit(1)
    }

    const limitBytes = parseLimit(opts.limit)
    const ignored = new Set(opts.ignore ? opts.ignore.split(',').map((s) => s.trim()) : [])

    const pkgs = extractImports(source).filter((p) => !ignored.has(p))

    if (pkgs.length === 0) {
      console.log('No external imports found.')
      process.exit(0)
    }

    const results: ImportResult[] = []

    for (const pkg of pkgs) {
      let bytes: number
      try {
        bytes = await measureImportSize(pkg)
      } catch {
        console.error(`Warning: could not bundle "${pkg}", skipping.`)
        continue
      }
      results.push({ pkg, bytes, exceeded: bytes > limitBytes })
    }

    if (opts.json) {
      printJsonResults(results, limitBytes)
    } else {
      printResults(results, limitBytes)
    }

    const violations = results.filter((r) => r.exceeded)
    if (violations.length > 0) {
      if (!opts.json) {
        console.log(`\n${violations.length} import(s) exceeded the ${opts.limit} limit.`)
      }
      if (opts.fail) {
        process.exit(1)
      }
    }
  })

program.parse()
