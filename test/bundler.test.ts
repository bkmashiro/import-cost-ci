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
// Guard tests: empty output arrays
//
// Each test spawns a subprocess that stubs the relevant bundler module to
// return an empty/invalid output, then asserts that measureImportSize throws
// with the expected error message.  The subprocess pattern mirrors what the
// CLI integration tests do below.
// ---------------------------------------------------------------------------

function spawnGuardHarness(bundlerStubSrc: string, adapter: string): { status: number | null; stderr: string } {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-guard-test-'))
  try {
    const bundlerShim = join(dir, 'bundler-shim.ts')
    const harness = join(dir, 'harness.ts')

    // Write the stub that replaces the real bundler module internals.
    writeFileSync(bundlerShim, bundlerStubSrc)

    // The harness rewrites bundler.ts imports to use the shim, then calls
    // measureImportSize and checks the thrown error.
    const bundlerSrc = readFileSync(new URL('../src/bundler.ts', import.meta.url), 'utf8')
    const shimUrl = pathToFileURL(bundlerShim).href
    const patched = bundlerSrc
      .replace(/await import\('esbuild'\)/, `await import(${JSON.stringify(shimUrl)})`)
      .replace(/await import\('rollup'\)/, `await import(${JSON.stringify(shimUrl)})`)

    const patchedBundler = join(dir, 'bundler-patched.ts')
    writeFileSync(patchedBundler, patched)

    writeFileSync(harness, `
import { measureImportSize } from ${JSON.stringify(pathToFileURL(patchedBundler).href)}
try {
  await measureImportSize('some-pkg', ${JSON.stringify(adapter)})
  process.stderr.write('ERROR: expected throw but got none\\n')
  process.exit(2)
} catch (e) {
  process.stdout.write(e.message + '\\n')
  process.exit(0)
}
`)

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', harness],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    return { status: result.status, stderr: result.stderr + result.stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('esbuild guard: throws when outputFiles is empty', () => {
  const stub = `
export default {
  build: async () => ({ outputFiles: [] }),
}
`
  const { status, stderr } = spawnGuardHarness(stub, 'esbuild')
  assert.equal(status, 0, `subprocess failed:\n${stderr}`)
  assert.match(stderr, /esbuild returned no output files/)
})

test('rollup guard: throws when output is empty', () => {
  const stub = `
export async function rollup() {
  return {
    generate: async () => ({ output: [] }),
    close: async () => {},
  }
}
export { rollup as default }
`
  // nodeResolve and terser are real plugins; they won't be called since we
  // stub rollup itself, but the import calls still need to succeed.
  const { status, stderr } = spawnGuardHarness(stub, 'rollup')
  assert.equal(status, 0, `subprocess failed:\n${stderr}`)
  assert.match(stderr, /rollup returned no output chunks/)
})

test('rollup guard: throws when output[0] is not a chunk', () => {
  const stub = `
export async function rollup() {
  return {
    generate: async () => ({ output: [{ type: 'asset', fileName: 'x.js', source: '' }] }),
    close: async () => {},
  }
}
`
  const { status, stderr } = spawnGuardHarness(stub, 'rollup')
  assert.equal(status, 0, `subprocess failed:\n${stderr}`)
  assert.match(stderr, /rollup output\[0\] is not a chunk/)
})

test('rollup guard: throws when chunk.code is falsy', () => {
  const stub = `
export async function rollup() {
  return {
    generate: async () => ({ output: [{ type: 'chunk', code: '' }] }),
    close: async () => {},
  }
}
`
  const { status, stderr } = spawnGuardHarness(stub, 'rollup')
  assert.equal(status, 0, `subprocess failed:\n${stderr}`)
  assert.match(stderr, /rollup chunk has no code/)
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
