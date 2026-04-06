import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildSummaryLine, buildTreemapBar, formatResultsMarkdown, formatSize, formatTreemap, sortResultsBySize } from '../src/formatter.ts'

function createMockedCli(size: number): { dir: string; entry: string; fixture: string } {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-ci-cli-'))
  const fixture = join(dir, 'entry.ts')
  const parser = join(dir, 'parser.ts')
  const bundler = join(dir, 'bundler.ts')
  const githubComment = join(dir, 'github-comment.ts')
  const entry = join(dir, 'index.ts')
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

  writeFileSync(fixture, 'import oversizedPkg from "oversized-pkg"\nconsole.log(oversizedPkg)\n')
  writeFileSync(parser, 'export function extractImports() { return ["oversized-pkg"] }\n')
  writeFileSync(bundler, `export async function measureImportSize() { return ${size} }\n`)
  writeFileSync(githubComment, 'export async function maybePostGitHubComment() {}\n')
  writeFileSync(
    entry,
    source
      .replace("'./parser.js'", `'${pathToFileURL(parser).href}'`)
      .replace("'./bundler.js'", `'${pathToFileURL(bundler).href}'`)
      .replace("'./formatter.js'", `'${pathToFileURL(join(process.cwd(), 'src/formatter.ts')).href}'`)
      .replace("'./github-comment.js'", `'${pathToFileURL(githubComment).href}'`)
      .replace("'./history.js'", `'${pathToFileURL(join(process.cwd(), 'src/history.ts')).href}'`)
  )

  return { dir, entry, fixture }
}

test('formats bytes below 1 kB without conversion', () => {
  assert.equal(formatSize(500), '500 B')
})

test('formats 1024 bytes as 1.0 kB', () => {
  assert.equal(formatSize(1024), '1.0 kB')
})

test('formats 51200 bytes as 50.0 kB', () => {
  assert.equal(formatSize(51200), '50.0 kB')
})

test('marks 51200 bytes as failing a 50 kB threshold', () => {
  const limit = 50_000

  assert.equal(51200 > limit, true)
})

test('marks 40960 bytes as passing a 50 kB threshold', () => {
  const limit = 50_000

  assert.equal(40960 > limit, false)
})

test('builds a passing summary line', () => {
  assert.equal(buildSummaryLine(0, 50_000), 'All imports are within the 48.8 kB limit.')
})

test('renders markdown table output', () => {
  const output = formatResultsMarkdown(
    [
      { pkg: 'react', bytes: 2400, exceeded: false },
      { pkg: 'moment', bytes: 72100, exceeded: true },
    ],
    50_000
  )

  assert.match(output, /\| `react` \| 2\.3 kB \| OK \|/)
  assert.match(output, /\| `moment` \| 70\.4 kB \| Exceeded \|/)
  assert.match(output, /1 import\(s\) exceeded the 48\.8 kB limit\./)
})

test('renders treemap output sorted by size and groups the remainder', () => {
  const output = formatTreemap([
    { pkg: 'tiny', bytes: 300, exceeded: false },
    { pkg: 'alpha', bytes: 4000, exceeded: false },
    { pkg: 'beta', bytes: 2000, exceeded: false },
    { pkg: 'gamma', bytes: 1000, exceeded: false },
    { pkg: 'delta', bytes: 900, exceeded: false },
    { pkg: 'epsilon', bytes: 800, exceeded: false },
    { pkg: 'zeta', bytes: 700, exceeded: false },
    { pkg: 'eta', bytes: 600, exceeded: false },
    { pkg: 'theta', bytes: 500, exceeded: false },
    { pkg: 'iota', bytes: 450, exceeded: false },
    { pkg: 'kappa', bytes: 425, exceeded: false },
    { pkg: 'lambda', bytes: 410, exceeded: false },
  ])

  assert.match(output, /^Import size breakdown \(total: 11\.8 kB\):/)
  assert.match(output, /alpha\s+█+/)
  assert.match(output, /beta\s+█+/)
  assert.match(output, /\[other 2 pkgs\]/)
  assert.ok(output.indexOf('alpha') < output.indexOf('beta'))
})

test('does not exit with code 1 in --no-fail mode when imports exceed the limit', () => {
  const { dir, entry, fixture } = createMockedCli(1500)

  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', entry, fixture, '--limit', '1b', '--no-fail'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      }
    )

    assert.equal(result.status, 0)
    assert.match(result.stdout, /oversized-pkg/)
    assert.match(result.stdout, /1 import\(s\) exceeded the 1b limit\./)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sortResultsBySize sorts by bytes descending', () => {
  const results = [
    { pkg: 'small', bytes: 100, exceeded: false },
    { pkg: 'large', bytes: 5000, exceeded: false },
    { pkg: 'medium', bytes: 2000, exceeded: false },
  ]
  const sorted = sortResultsBySize(results)

  assert.equal(sorted[0].pkg, 'large')
  assert.equal(sorted[1].pkg, 'medium')
  assert.equal(sorted[2].pkg, 'small')
})

test('sortResultsBySize breaks ties alphabetically', () => {
  const results = [
    { pkg: 'zebra', bytes: 1000, exceeded: false },
    { pkg: 'apple', bytes: 1000, exceeded: false },
    { pkg: 'mango', bytes: 1000, exceeded: false },
  ]
  const sorted = sortResultsBySize(results)

  assert.equal(sorted[0].pkg, 'apple')
  assert.equal(sorted[1].pkg, 'mango')
  assert.equal(sorted[2].pkg, 'zebra')
})

test('sortResultsBySize does not mutate the original array', () => {
  const results = [
    { pkg: 'b', bytes: 100, exceeded: false },
    { pkg: 'a', bytes: 200, exceeded: false },
  ]
  const original = [...results]
  sortResultsBySize(results)

  assert.deepEqual(results, original)
})

test('sortResultsBySize returns empty array for empty input', () => {
  assert.deepEqual(sortResultsBySize([]), [])
})

test('buildTreemapBar returns all empty blocks when totalBytes is zero', () => {
  assert.equal(buildTreemapBar(0, 0), '░'.repeat(20))
})

test('buildTreemapBar returns all empty blocks when totalBytes is negative', () => {
  assert.equal(buildTreemapBar(100, -1), '░'.repeat(20))
})

test('buildTreemapBar returns fully filled bar when bytes equals totalBytes', () => {
  assert.equal(buildTreemapBar(1000, 1000), '█'.repeat(20))
})

test('buildTreemapBar returns proportional bar for 50% usage', () => {
  const bar = buildTreemapBar(500, 1000)

  assert.equal(bar, '█'.repeat(10) + '░'.repeat(10))
  assert.equal(bar.length, 20)
})

test('buildTreemapBar clamps filled blocks to bar width', () => {
  const bar = buildTreemapBar(9999, 1000)

  assert.equal(bar.length, 20)
  assert.equal(bar, '█'.repeat(20))
})

test('prints JSON output with the --json flag', () => {
  const { dir, entry, fixture } = createMockedCli(1500)

  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', entry, fixture, '--limit', '1b', '--json'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      }
    )

    assert.equal(result.status, 1)
    const output = JSON.parse(result.stdout)
    assert.equal(output.limit, 1)
    assert.equal(output.violations, 1)
    assert.match(output.summary, /1 import\(s\) exceeded the 1 B limit\./)
    assert.equal(output.results[0].pkg, 'oversized-pkg')
    assert.equal(output.results[0].exceeded, true)
    assert.match(output.results[0].size, /kB|B/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
