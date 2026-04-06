import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { printResults } from '../src/formatter.ts'
import { maybePostGitHubComment, parsePullRequestRef } from '../src/github-comment.ts'

function withEnv(
  overrides: Partial<Record<'GITHUB_REPOSITORY' | 'GITHUB_EVENT_NAME' | 'GITHUB_EVENT_PATH' | 'GITHUB_TOKEN', string | undefined>>,
  fn: () => void | Promise<void>
): void | Promise<void> {
  const previous = {
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
    GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  const restore = (): void => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  try {
    const result = fn()
    if (result && typeof (result as Promise<void>).finally === 'function') {
      return (result as Promise<void>).finally(restore)
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

function createEventFile(content: unknown): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-ci-'))
  const path = join(dir, 'event.json')
  writeFileSync(path, JSON.stringify(content))
  return { dir, path }
}

function createMockedCli(options?: {
  fixtureSource?: string
  parserSource?: string
  bundlerSource?: string
  githubCommentSource?: string
}): { dir: string; entry: string; fixture: string } {
  const dir = mkdtempSync(join(process.cwd(), 'import-cost-ci-cli-'))
  const fixture = join(dir, 'entry.ts')
  const parser = join(dir, 'parser.ts')
  const bundler = join(dir, 'bundler.ts')
  const githubComment = join(dir, 'github-comment.ts')
  const entry = join(dir, 'index.ts')
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

  writeFileSync(
    fixture,
    options?.fixtureSource ?? 'import oversizedPkg from "oversized-pkg"\nconsole.log(oversizedPkg)\n'
  )
  writeFileSync(parser, options?.parserSource ?? 'export function extractImports() { return ["oversized-pkg"] }\n')
  writeFileSync(
    bundler,
    options?.bundlerSource ?? 'export async function measureImportSize() { return 1500 }\n'
  )
  writeFileSync(
    githubComment,
    options?.githubCommentSource ?? 'export async function maybePostGitHubComment() {}\n'
  )
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

test('printResults logs non-exceeded imports with the success marker', () => {
  const previousLog = console.log
  const messages: string[] = []

  console.log = (message?: unknown) => {
    messages.push(String(message))
  }

  try {
    printResults([{ pkg: 'chalk', bytes: 700, exceeded: false }], 50_000)
  } finally {
    console.log = previousLog
  }

  assert.equal(messages.length, 1)
  assert.match(messages[0], /chalk/)
  assert.match(messages[0], /700 B/)
})

test('parsePullRequestRef returns null when GITHUB_REPOSITORY is malformed', () => {
  const event = createEventFile({ pull_request: { number: 42 } })

  try {
    return withEnv(
      {
        GITHUB_REPOSITORY: 'acme-only',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: event.path,
      },
      () => {
        assert.equal(parsePullRequestRef(), null)
      }
    )
  } finally {
    rmSync(event.dir, { recursive: true, force: true })
  }
})

test('parsePullRequestRef returns null when the pull request number is missing', () => {
  const event = createEventFile({ pull_request: {} })

  try {
    return withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: event.path,
      },
      () => {
        assert.equal(parsePullRequestRef(), null)
      }
    )
  } finally {
    rmSync(event.dir, { recursive: true, force: true })
  }
})

test('maybePostGitHubComment returns early when GITHUB_TOKEN is not set', async () => {
  const previousFetch = globalThis.fetch
  let called = false

  globalThis.fetch = async () => {
    called = true
    return new Response(null, { status: 200 })
  }

  try {
    await withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: '/tmp/unused.json',
        GITHUB_TOKEN: undefined,
      },
      async () => {
        await maybePostGitHubComment([{ pkg: 'chalk', bytes: 700, exceeded: false }], 50_000)
      }
    )
    assert.equal(called, false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('maybePostGitHubComment throws when the GitHub API request fails', async () => {
  const event = createEventFile({ pull_request: { number: 42 } })
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => new Response('nope', { status: 500, statusText: 'Internal Server Error' })

  try {
    await withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: event.path,
        GITHUB_TOKEN: 'test-token',
      },
      async () => {
        await assert.rejects(
          maybePostGitHubComment([{ pkg: 'chalk', bytes: 700, exceeded: false }], 50_000),
          /GitHub API request failed: 500 Internal Server Error/
        )
      }
    )
  } finally {
    globalThis.fetch = previousFetch
    rmSync(event.dir, { recursive: true, force: true })
  }
})

test('CLI exits with an error when the input file cannot be read', () => {
  const result = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'test/fixtures/does-not-exist.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Error: cannot read file "test\/fixtures\/does-not-exist\.ts"/)
})

test('CLI reports when no external imports are found', () => {
  const { dir, entry, fixture } = createMockedCli({
    fixtureSource: 'const value = 1\nconsole.log(value)\n',
    parserSource: 'export function extractImports() { return [] }\n',
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /No external imports found\./)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI warns and skips packages that cannot be bundled, including error message', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: 'export async function measureImportSize() { throw new Error("bundle failed") }\n',
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0)
    assert.match(result.stderr, /Warning: could not bundle "oversized-pkg", skipping\./)
    assert.match(result.stderr, /bundle failed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI warns and skips packages that throw a non-Error value', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: 'export async function measureImportSize() { throw "string rejection" }\n',
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0)
    assert.match(result.stderr, /Warning: could not bundle "oversized-pkg", skipping\./)
    assert.match(result.stderr, /string rejection/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI warns when posting the GitHub PR comment fails', () => {
  const { dir, entry, fixture } = createMockedCli({
    githubCommentSource: 'export async function maybePostGitHubComment() { throw new Error("boom") }\n',
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0)
    assert.match(result.stderr, /Warning: could not post GitHub PR comment: boom/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI uses GitHub Action inputs to populate argv', () => {
  const { dir, entry, fixture } = createMockedCli()

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        INPUT_FILE: fixture,
        INPUT_LIMIT: '1b',
        INPUT_NO_FAIL: 'false',
      },
    })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /oversized-pkg/)
    assert.match(result.stdout, /1 import\(s\) exceeded the 1b limit\./)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI passes INPUT_BUNDLER to --bundler when set', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: `
      export async function measureImportSize(_pkg, bundler) {
        process.stderr.write('bundler:' + bundler + '\\n')
        return 500
      }
    `,
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        INPUT_FILE: fixture,
        INPUT_BUNDLER: 'webpack',
        INPUT_NO_FAIL: 'true',
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stderr, /bundler:webpack/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI omits --bundler flag when INPUT_BUNDLER is not set (uses CLI default)', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: `
      export async function measureImportSize(_pkg, bundler) {
        process.stderr.write('bundler:' + bundler + '\\n')
        return 500
      }
    `,
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture, '--no-fail'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, INPUT_BUNDLER: undefined },
    })

    assert.equal(result.status, 0)
    // Commander default is 'esbuild' when --bundler is not passed
    assert.match(result.stderr, /bundler:esbuild/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI forwards unknown bundler value as-is from INPUT_BUNDLER', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: `
      export async function measureImportSize(_pkg, bundler) {
        process.stderr.write('bundler:' + bundler + '\\n')
        return 500
      }
    `,
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        INPUT_FILE: fixture,
        INPUT_BUNDLER: 'rollup',
        INPUT_NO_FAIL: 'true',
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stderr, /bundler:rollup/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI prints the treemap when --treemap is passed', () => {
  const { dir, entry, fixture } = createMockedCli({
    parserSource: 'export function extractImports() { return ["beta", "alpha", "gamma"] }\n',
    bundlerSource: `
      export async function measureImportSize(pkg) {
        return { alpha: 4000, beta: 2000, gamma: 1000 }[pkg]
      }
    `,
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture, '--treemap', '--no-fail'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Import size breakdown \(total: 6\.8 kB\):/)
    assert.ok(result.stdout.indexOf('alpha') < result.stdout.indexOf('beta'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI writes and prints history when --history is passed', () => {
  const { dir, entry, fixture } = createMockedCli({
    parserSource: 'export function extractImports() { return ["alpha", "beta"] }\n',
    bundlerSource: `
      export async function measureImportSize(pkg) {
        return { alpha: 1200, beta: 800 }[pkg]
      }
    `,
  })

  try {
    const first = spawnSync('pnpm', ['exec', 'tsx', entry, fixture, '--history', '--no-fail'], {
      cwd: dir,
      encoding: 'utf8',
    })
    const second = spawnSync('pnpm', ['exec', 'tsx', entry, fixture, '--history', '--no-fail'], {
      cwd: dir,
      encoding: 'utf8',
    })

    assert.equal(first.status, 0)
    assert.equal(second.status, 0)
    assert.match(second.stdout, /Current: 2\.0 kB/)
    assert.match(second.stdout, /History:/)
    assert.equal(existsSync(join(dir, '.import-cost-history.json')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI auto-enables history for GitHub Action pushes to main', () => {
  const { dir, entry, fixture } = createMockedCli()
  const eventPath = join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify({ ref: 'refs/heads/main' }))

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        INPUT_FILE: fixture,
        INPUT_NO_FAIL: 'true',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Current:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI --limit 50kb allows a package just under the 1024-based boundary (51199 bytes)', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: 'export async function measureImportSize() { return 51199 }\n',
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture, '--limit', '50kb', '--no-fail'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /✓/)
    assert.doesNotMatch(result.stdout, /exceeded/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI --limit 50kb rejects a package just over the 1024-based boundary (51201 bytes)', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: 'export async function measureImportSize() { return 51201 }\n',
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture, '--limit', '50kb'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /✗/)
    assert.match(result.stdout, /exceeded/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI --limit 50kb accepts exactly 51200 bytes (the boundary itself)', () => {
  const { dir, entry, fixture } = createMockedCli({
    bundlerSource: 'export async function measureImportSize() { return 51200 }\n',
  })

  try {
    const result = spawnSync('pnpm', ['exec', 'tsx', entry, fixture, '--limit', '50kb', '--no-fail'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /✓/)
    assert.doesNotMatch(result.stdout, /exceeded/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
