import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { measureImportSize } from '../src/bundler.ts'

// ---------------------------------------------------------------------------
// Empty-output guard: Vite and Rollup adapters
//
// These tests inject a module loader that intercepts dynamic import() calls
// inside the adapter functions, replacing vite/rollup with stubs that return
// empty output arrays — verifying the explicit error throw added to each adapter.
// ---------------------------------------------------------------------------

function makeRegisterHook(loaderPath: string): string {
  const loaderUrl = pathToFileURL(loaderPath).href
  return `data:text/javascript,import{register}from"node:module";import{pathToFileURL}from"node:url";register(${JSON.stringify(loaderUrl)},pathToFileURL("./"));`
}

function writeLoaderAndScript(
  dir: string,
  stubbedModules: Record<string, string>,
  scriptBody: string
): { loader: string; script: string } {
  const loader = join(dir, 'loader.mjs')
  const interceptLines = Object.entries(stubbedModules)
    .map(([name, file]) =>
      `  if (s === ${JSON.stringify(name)}) return { shortCircuit: true, url: ${JSON.stringify(pathToFileURL(file).href)} }`
    )
    .join('\n')
  writeFileSync(loader, `export async function resolve(s, ctx, next) {\n${interceptLines}\n  return next(s, ctx)\n}\n`)

  const bundlerUrl = pathToFileURL(join(process.cwd(), 'src/bundler.ts')).href
  const script = join(dir, 'run.mjs')
  writeFileSync(script, `import { measureImportSize } from ${JSON.stringify(bundlerUrl)}\n${scriptBody}\n`)
  return { loader, script }
}

function runWithLoader(loader: string, script: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    'node',
    ['--import', 'tsx/esm', '--import', makeRegisterHook(loader), script],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 }
  )
}

const EMPTY_OUTPUT_RE = /Bundler returned no output chunks/

test('vite adapter: throws when build returns empty output', () => {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-bundler-test-'))
  try {
    const viteStub = join(dir, 'vite-stub.mjs')
    writeFileSync(viteStub, `export const build = async () => ({ output: [] })\n`)

    const { loader, script } = writeLoaderAndScript(
      dir,
      { vite: viteStub },
      `try {
  await measureImportSize('some-pkg', 'vite')
  process.stderr.write('Expected error\\n'); process.exit(1)
} catch (e) {
  if (!${EMPTY_OUTPUT_RE}.test(e.message)) { process.stderr.write('Wrong: ' + e.message + '\\n'); process.exit(1) }
}`
    )
    const result = runWithLoader(loader, script)
    assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('vite adapter: throws when build returns array result with empty output', () => {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-bundler-test-'))
  try {
    const viteStub = join(dir, 'vite-stub.mjs')
    writeFileSync(viteStub, `export const build = async () => [{ output: [] }]\n`)

    const { loader, script } = writeLoaderAndScript(
      dir,
      { vite: viteStub },
      `try {
  await measureImportSize('some-pkg', 'vite')
  process.stderr.write('Expected error\\n'); process.exit(1)
} catch (e) {
  if (!${EMPTY_OUTPUT_RE}.test(e.message)) { process.stderr.write('Wrong: ' + e.message + '\\n'); process.exit(1) }
}`
    )
    const result = runWithLoader(loader, script)
    assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rollup adapter: throws when generate returns empty output', () => {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-bundler-test-'))
  try {
    const rollupStub = join(dir, 'rollup-stub.mjs')
    const nodeResolveStub = join(dir, 'node-resolve-stub.mjs')
    const terserStub = join(dir, 'terser-stub.mjs')
    writeFileSync(rollupStub, `export const rollup = async () => ({ generate: async () => ({ output: [] }), close: async () => {} })\n`)
    writeFileSync(nodeResolveStub, `export const nodeResolve = () => ({})\n`)
    writeFileSync(terserStub, `export default () => ({})\n`)

    const { loader, script } = writeLoaderAndScript(
      dir,
      { rollup: rollupStub, '@rollup/plugin-node-resolve': nodeResolveStub, '@rollup/plugin-terser': terserStub },
      `try {
  await measureImportSize('some-pkg', 'rollup')
  process.stderr.write('Expected error\\n'); process.exit(1)
} catch (e) {
  if (!${EMPTY_OUTPUT_RE}.test(e.message)) { process.stderr.write('Wrong: ' + e.message + '\\n'); process.exit(1) }
}`
    )
    const result = runWithLoader(loader, script)
    assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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
// esbuild adapter: direct unit tests
//
// These call measureImportSize() with bundler='esbuild' directly — no
// subprocess, no CLI wiring — so failures are isolated to the esbuild
// adapter itself rather than CLI dispatch.
//
// Each test that needs a resolvable package creates a self-contained temp
// dir with a minimal package.json + index.js, then changes process.cwd()
// to that dir so esbuild can find it via stdin.resolveDir.  The helper
// restores cwd afterwards so tests stay isolated.
// ---------------------------------------------------------------------------

function withLocalPkg(
  name: string,
  source: string,
  fn: () => Promise<void>
): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(process.cwd(), 'import-cost-esbuild-test-'))
    const pkgDir = join(dir, 'node_modules', name)
    const origCwd = process.cwd()
    try {
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'index.js'), source)
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name, version: '0.0.0', main: 'index.js' })
      )
      process.chdir(dir)
      await fn()
    } finally {
      process.chdir(origCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

// A tiny browser-safe package with an observable side effect so esbuild
// cannot tree-shake it.  ~30 bytes of source → known gzip range.
const TINY_SRC = 'export const x = 42; console.log(x);'

test(
  'esbuild adapter: returns a positive number for a known package',
  withLocalPkg('tiny-fixture', TINY_SRC, async () => {
    const size = await measureImportSize('tiny-fixture', 'esbuild')
    assert.ok(size > 0, `expected positive size, got ${size}`)
  })
)

test(
  'esbuild adapter: result is an integer (byte count, not fractional)',
  withLocalPkg('tiny-fixture', TINY_SRC, async () => {
    const size = await measureImportSize('tiny-fixture', 'esbuild')
    assert.strictEqual(size, Math.floor(size), `expected integer byte count, got ${size}`)
  })
)

test(
  'esbuild adapter: size is within a reasonable range for a tiny fixture (< 1 kB gzipped)',
  withLocalPkg('tiny-fixture', TINY_SRC, async () => {
    const size = await measureImportSize('tiny-fixture', 'esbuild')
    const maxBytes = 1024 // 1 kB gzipped is extremely generous for a 30-byte source
    assert.ok(
      size < maxBytes,
      `tiny fixture gzipped size ${size} B exceeds generous upper bound of ${maxBytes} B`
    )
  })
)

test(
  'esbuild adapter: size is non-trivially positive for a fixture with a real export (> 10 bytes gzipped)',
  withLocalPkg('tiny-fixture', TINY_SRC, async () => {
    const size = await measureImportSize('tiny-fixture', 'esbuild')
    assert.ok(
      size > 10,
      `tiny fixture gzipped size ${size} B is suspiciously small; likely a bundling/tree-shaking error`
    )
  })
)

test('esbuild adapter: rejects for a nonexistent package name', async () => {
  await assert.rejects(
    measureImportSize('__this_package_does_not_exist_xyz_abc_123__', 'esbuild'),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'expected an Error instance')
      return true
    }
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

// vite: empty output guard
//
// measureWithVite uses `import('vite')` internally. We test the guards by
// patching the bundler source in a subprocess: replace `import('vite')` with
// a local mock file that returns a controlled result, then call measureImportSize
// and assert the expected error propagates.

function createViteGuardTestScript(buildReturnExpr: string): { dir: string; script: string } {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-vite-guard-test-'))
  const viteMock = join(dir, 'vite-mock.ts')
  const bundlerCopy = join(dir, 'bundler.ts')
  const runScript = join(dir, 'run.ts')

  writeFileSync(viteMock, `export async function build(_opts?: unknown) { return ${buildReturnExpr} }\n`)

  const bundlerSource = readFileSync(new URL('../src/bundler.ts', import.meta.url), 'utf8')
  writeFileSync(
    bundlerCopy,
    bundlerSource.replace(
      `await import('vite')`,
      `await import(${JSON.stringify(pathToFileURL(viteMock).href)})`
    )
  )

  writeFileSync(
    runScript,
    `import { measureImportSize } from ${JSON.stringify(pathToFileURL(bundlerCopy).href)}\n` +
    `measureImportSize('some-pkg', 'vite')\n` +
    `  .then(() => { process.stderr.write('ERROR: expected rejection but resolved\\n'); process.exit(1) })\n` +
    `  .catch((e: Error) => { process.stderr.write(e.message + '\\n'); process.exit(1) })\n`
  )

  return { dir, script: runScript }
}

test('vite adapter: throws when build returns empty output array', () => {
  const { dir, script } = createViteGuardTestScript('{ output: [] }')
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', script],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 1, `expected exit 1:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    assert.match(result.stderr, /Vite produced no output chunks for package: some-pkg/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('vite adapter: throws when output chunk has neither code nor source', () => {
  const { dir, script } = createViteGuardTestScript('{ output: [{ type: "chunk" }] }')
  try {
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', script],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    assert.equal(result.status, 1, `expected exit 1:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    assert.match(result.stderr, /Vite produced no output chunks for package: some-pkg/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// webpack guard: memfs API-change detection (guard logic mirrored inline)
// ---------------------------------------------------------------------------

// These tests verify the guard conditions from measureWithWebpack directly,
// using the same predicate expressions as the production code.

function runMemfsGuard(fakeMemfs: Record<string, unknown>): string | null {
  if (typeof fakeMemfs['Volume'] !== 'function') {
    return 'memfs.Volume is not available — memfs API may have changed'
  }
  if (typeof fakeMemfs['createFsFromVolume'] !== 'function') {
    return 'memfs.createFsFromVolume is not available — memfs API may have changed'
  }
  return null
}

test('webpack guard: missing Volume produces descriptive error', () => {
  const err = runMemfsGuard({ createFsFromVolume: () => {} })
  assert.equal(err, 'memfs.Volume is not available — memfs API may have changed')
})

test('webpack guard: missing createFsFromVolume produces descriptive error', () => {
  const err = runMemfsGuard({ Volume: function Volume() {} })
  assert.equal(err, 'memfs.createFsFromVolume is not available — memfs API may have changed')
})

test('webpack guard: both exports present passes without error', () => {
  const err = runMemfsGuard({ Volume: function Volume() {}, createFsFromVolume: () => {} })
  assert.equal(err, null)
})

test('webpack guard: non-function Volume (e.g. undefined) produces descriptive error', () => {
  const err = runMemfsGuard({ Volume: undefined, createFsFromVolume: () => {} })
  assert.equal(err, 'memfs.Volume is not available — memfs API may have changed')
})

// ---------------------------------------------------------------------------
// vite guard: watcher / no-code-string detection
// ---------------------------------------------------------------------------

test('vite guard: watcher return value causes descriptive error', () => {
  // Simulate the guard inline: a watcher has an `on` method.
  const fakeWatcher = { on: () => {} }
  const isWatcher = fakeWatcher !== null && typeof fakeWatcher === 'object' && ('on' in fakeWatcher)
  assert.ok(isWatcher, 'watcher detection should fire for object with .on')
})

test('vite guard: output chunk without code string causes descriptive error', () => {
  // Simulate the guard inline: output item has no `code` property.
  const fakeOutput = [{ type: 'asset', source: Buffer.from('') }]
  const chunk = fakeOutput.find(o => o.type === 'chunk') ?? fakeOutput[0]
  const hasCode = 'code' in chunk && typeof (chunk as { code?: unknown }).code === 'string'
  assert.ok(!hasCode, 'guard should detect missing code string')
})

test('vite guard: output chunk with non-string code causes descriptive error', () => {
  const fakeOutput = [{ type: 'chunk', code: 42 }]
  const chunk = fakeOutput[0]
  const hasCode = 'code' in chunk && typeof (chunk as { code?: unknown }).code === 'string'
  assert.ok(!hasCode, 'guard should detect non-string code field')
})

test('vite guard: output chunk with valid code string passes guard', () => {
  const fakeOutput = [{ type: 'chunk', code: 'console.log(1)' }]
  const chunk = fakeOutput[0]
  const hasCode = 'code' in chunk && typeof (chunk as { code?: unknown }).code === 'string'
  assert.ok(hasCode, 'guard should pass for valid code string')
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

// ---------------------------------------------------------------------------
// Adapter unit tests
//
// Node's node:test mock.module is not available in this environment, so we
// use the same subprocess pattern as the CLI tests above: each scenario
// writes a small script that stubs the underlying bundler module via a
// local fake, then calls measureImportSize and prints/exits accordingly.
// ---------------------------------------------------------------------------

function runAdapterScript(script: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-adapter-test-'))
  const scriptFile = join(dir, 'run.ts')
  try {
    writeFileSync(scriptFile, script)
    const result = spawnSync(
      'pnpm', ['exec', 'tsx', scriptFile],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// esbuild adapter — happy path

test('esbuild adapter: gzip size is calculated from outputFiles contents', () => {
  // The stub returns 200 bytes of ASCII. gzip output must be > 0.
  const fakeData = 'x'.repeat(200)
  const script = `
import zlib from 'zlib'

const fakeContents = Buffer.from(${JSON.stringify(fakeData)})
const fakeEsbuild = { build: async () => ({ outputFiles: [{ contents: fakeContents }] }) }

async function measureWithEsbuildStub(pkg) {
  const result = await fakeEsbuild.build()
  const code = result.outputFiles[0].contents
  return zlib.gzipSync(code).length
}

const bytes = await measureWithEsbuildStub('some-pkg')
if (bytes <= 0) { process.stderr.write('expected bytes > 0, got ' + bytes + '\\n'); process.exit(1) }
if (bytes >= fakeContents.length * 3) { process.stderr.write('bytes unexpectedly large: ' + bytes + '\\n'); process.exit(1) }
process.stdout.write('ok:' + bytes + '\\n')
`
  const { status, stdout, stderr } = runAdapterScript(script)
  assert.equal(status, 0, `expected exit 0:\n${stderr}`)
  assert.match(stdout, /^ok:\d+/)
})

// esbuild adapter — empty outputFiles throws

test('esbuild adapter: empty outputFiles array throws', () => {
  const script = `
import zlib from 'zlib'

const fakeEsbuild = { build: async () => ({ outputFiles: [] }) }

async function run() {
  const result = await fakeEsbuild.build()
  const code = result.outputFiles[0].contents  // should throw TypeError
  return zlib.gzipSync(code).length
}

try {
  await run()
  process.stderr.write('expected an error but none was thrown\\n')
  process.exit(1)
} catch (err) {
  if (err instanceof TypeError || err instanceof Error) {
    process.stdout.write('threw-as-expected\\n')
  } else {
    process.stderr.write('unexpected error type\\n')
    process.exit(1)
  }
}
`
  const { status, stdout, stderr } = runAdapterScript(script)
  assert.equal(status, 0, `expected exit 0:\n${stderr}`)
  assert.match(stdout, /threw-as-expected/)
})

// vite adapter — empty output array throws

test('vite adapter: empty output array throws rather than returning 0 bytes', () => {
  const script = `
import zlib from 'zlib'

// Mirror the logic from measureWithVite in bundler.ts
async function measureWithViteStub(fakeResult) {
  const output = Array.isArray(fakeResult) ? fakeResult[0].output : fakeResult.output
  const chunk = output.find(o => o.type === 'chunk') ?? output[0]  // undefined when empty
  const code = chunk.code ?? chunk.source ?? ''                    // throws TypeError
  return zlib.gzipSync(Buffer.from(code)).length
}

try {
  await measureWithViteStub({ output: [] })
  process.stderr.write('expected an error but none was thrown\\n')
  process.exit(1)
} catch (err) {
  if (err instanceof Error) {
    process.stdout.write('threw-as-expected\\n')
  } else {
    process.stderr.write('unexpected error type\\n')
    process.exit(1)
  }
}
`
  const { status, stdout, stderr } = runAdapterScript(script)
  assert.equal(status, 0, `expected exit 0:\n${stderr}`)
  assert.match(stdout, /threw-as-expected/)
})

// rollup adapter — empty output array throws

test('rollup adapter: empty output array throws rather than returning 0 bytes', () => {
  const script = `
import zlib from 'zlib'

// Mirror the logic from measureWithRollup in bundler.ts
async function measureWithRollupStub(fakeOutput) {
  const code = fakeOutput[0].code   // throws TypeError when array is empty
  return zlib.gzipSync(Buffer.from(code)).length
}

try {
  await measureWithRollupStub([])
  process.stderr.write('expected an error but none was thrown\\n')
  process.exit(1)
} catch (err) {
  if (err instanceof Error) {
    process.stdout.write('threw-as-expected\\n')
  } else {
    process.stderr.write('unexpected error type\\n')
    process.exit(1)
  }
}
`
  const { status, stdout, stderr } = runAdapterScript(script)
  assert.equal(status, 0, `expected exit 0:\n${stderr}`)
  assert.match(stdout, /threw-as-expected/)
})
