import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { measureImportSize } from '../src/bundler.ts'

// ---------------------------------------------------------------------------
// measureImportSize: dispatch guard
// ---------------------------------------------------------------------------

test('measureImportSize throws for an unknown bundler name', async () => {
  await assert.rejects(
    // @ts-expect-error intentionally passing an invalid bundler name
    measureImportSize('some-pkg', 'parcel'),
    /Unknown bundler: parcel\. Supported: esbuild, webpack, vite, rollup/
  )
})

// ---------------------------------------------------------------------------
// Per-adapter CLI integration tests
//
// Each bundler adapter is tested via a subprocess that:
//   1. stubs measureImportSize to record which bundler was passed and return a
//      fixed byte count — so no real package resolution is needed.
//   2. verifies the CLI forwards --bundler <name> to measureImportSize.
//   3. verifies that the size limit is applied to the stub's returned value.
//
// This mirrors the pattern used in cli-and-coverage.test.ts.
// ---------------------------------------------------------------------------

function createBundlerMockedCli(
  expectedBundler: string,
  returnBytes = 1200
): { dir: string; entry: string; fixture: string } {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-bundler-test-'))
  const fixture = join(dir, 'entry.ts')
  const parser = join(dir, 'parser.ts')
  const bundler = join(dir, 'bundler.ts')
  const githubComment = join(dir, 'github-comment.ts')
  const entry = join(dir, 'index.ts')
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

  writeFileSync(fixture, 'import chalk from "chalk"\nconsole.log(chalk)\n')
  writeFileSync(parser, 'export function extractImports() { return ["chalk"] }\n')
  writeFileSync(
    bundler,
    `export async function measureImportSize(pkg, bundler) {
  if (bundler !== ${JSON.stringify(expectedBundler)}) {
    process.stderr.write('WRONG BUNDLER: ' + bundler + '\\n')
    process.exit(2)
  }
  return ${returnBytes}
}\n`
  )
  writeFileSync(githubComment, 'export async function maybePostGitHubComment() {}\n')
  writeFileSync(
    entry,
    source
      .replace("'./parser.js'", `'${pathToFileURL(join(dir, 'parser.ts')).href}'`)
      .replace("'./bundler.js'", `'${pathToFileURL(join(dir, 'bundler.ts')).href}'`)
      .replace("'./formatter.js'", `'${pathToFileURL(join(process.cwd(), 'src/formatter.ts')).href}'`)
      .replace("'./github-comment.js'", `'${pathToFileURL(join(dir, 'github-comment.ts')).href}'`)
      .replace("'./history.js'", `'${pathToFileURL(join(process.cwd(), 'src/history.ts')).href}'`)
  )

  return { dir, entry, fixture }
}

// webpack

test('webpack adapter: CLI forwards --bundler webpack to measureImportSize', () => {
  const { dir, entry, fixture } = createBundlerMockedCli('webpack')
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', entry, fixture, '--bundler', 'webpack', '--no-fail'],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 0, `expected exit 0:\n${result.stderr}`)
    assert.match(result.stdout, /chalk/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('webpack adapter: size limit is applied to the webpack-measured byte count', () => {
  const { dir, entry, fixture } = createBundlerMockedCli('webpack', 1200)
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', entry, fixture, '--bundler', 'webpack', '--limit', '1b', '--no-fail'],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 0)
    assert.match(result.stdout, /exceeded/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// vite

test('vite adapter: CLI forwards --bundler vite to measureImportSize', () => {
  const { dir, entry, fixture } = createBundlerMockedCli('vite')
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', entry, fixture, '--bundler', 'vite', '--no-fail'],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 0, `expected exit 0:\n${result.stderr}`)
    assert.match(result.stdout, /chalk/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('vite adapter: size limit is applied to the vite-measured byte count', () => {
  const { dir, entry, fixture } = createBundlerMockedCli('vite', 800)
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', entry, fixture, '--bundler', 'vite', '--limit', '1b', '--no-fail'],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 0)
    assert.match(result.stdout, /exceeded/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// rollup

test('rollup adapter: CLI forwards --bundler rollup to measureImportSize', () => {
  const { dir, entry, fixture } = createBundlerMockedCli('rollup')
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', entry, fixture, '--bundler', 'rollup', '--no-fail'],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 0, `expected exit 0:\n${result.stderr}`)
    assert.match(result.stdout, /chalk/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rollup adapter: size limit is applied to the rollup-measured byte count', () => {
  const { dir, entry, fixture } = createBundlerMockedCli('rollup', 5000)
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', entry, fixture, '--bundler', 'rollup', '--limit', '1b', '--no-fail'],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 0)
    assert.match(result.stdout, /exceeded/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
