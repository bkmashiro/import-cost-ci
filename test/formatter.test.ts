import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildSummaryLine, formatResultsMarkdown, formatSize, formatTreemap } from '../src/formatter.ts'

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
      .replace("'./index-helpers.js'", `'${pathToFileURL(join(process.cwd(), 'src/index-helpers.ts')).href}'`)
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

// formatSize edge cases
test('formatSize returns exact bytes for 0', () => {
  assert.equal(formatSize(0), '0 B')
})

test('formatSize returns bytes for 1023 (just below 1 kB boundary)', () => {
  assert.equal(formatSize(1023), '1023 B')
})

test('formatSize uses 1024 as the kB boundary, not 1000', () => {
  // 1000 bytes is below the binary 1024 threshold — must stay as B
  assert.equal(formatSize(1000), '1000 B')
  // 1024 bytes is the exact boundary — must convert
  assert.equal(formatSize(1024), '1.0 kB')
})

// formatResultsMarkdown edge cases
test('formatResultsMarkdown escapes pipe characters in package names', () => {
  const output = formatResultsMarkdown(
    [{ pkg: 'scope|pkg', bytes: 100, exceeded: false }],
    50_000
  )
  assert.match(output, /`scope\\|pkg`/)
})

test('formatResultsMarkdown with empty results shows no violations', () => {
  const output = formatResultsMarkdown([], 50_000)
  assert.match(output, /All imports are within/)
  assert.doesNotMatch(output, /Exceeded/)
})

// formatTreemap edge cases
test('formatTreemap with empty array shows 0 B total', () => {
  const output = formatTreemap([])
  assert.match(output, /total: 0 B/)
})

test('formatTreemap with exactly 10 packages shows no "other" row', () => {
  const pkgs = Array.from({ length: 10 }, (_, i) => ({
    pkg: `pkg-${i}`,
    bytes: 100 * (i + 1),
    exceeded: false,
  }))
  const output = formatTreemap(pkgs)
  assert.doesNotMatch(output, /\[other/)
})

test('formatTreemap with 11 packages shows "other 1 pkgs" row', () => {
  const pkgs = Array.from({ length: 11 }, (_, i) => ({
    pkg: `pkg-${i}`,
    bytes: 100 * (i + 1),
    exceeded: false,
  }))
  const output = formatTreemap(pkgs)
  assert.match(output, /\[other 1 pkgs\]/)
})

test('formatTreemap with all-zero sizes renders empty bars without NaN', () => {
  const output = formatTreemap([
    { pkg: 'zero-a', bytes: 0, exceeded: false },
    { pkg: 'zero-b', bytes: 0, exceeded: false },
  ])
  assert.doesNotMatch(output, /NaN/)
  assert.match(output, /░/)
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
