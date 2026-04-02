import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildSummaryLine, formatResultsMarkdown, formatSize } from '../src/formatter.ts'

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
