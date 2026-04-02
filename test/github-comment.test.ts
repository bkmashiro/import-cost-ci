import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  buildCommentBody,
  maybePostGitHubComment,
  parsePullRequestRef,
} from '../src/github-comment.ts'
import { formatResultsMarkdown } from '../src/formatter.ts'

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

test('builds a comment body with marker and markdown report', () => {
  const body = buildCommentBody(
    [
      { pkg: 'react', bytes: 2400, exceeded: false },
      { pkg: 'moment', bytes: 72100, exceeded: true },
    ],
    50_000
  )

  assert.match(body, /^<!-- import-cost-ci -->/)
  assert.match(body, /## import-cost-ci report/)
  assert.match(body, /\| `moment` \| 70\.4 kB \| Exceeded \|/)
})

test('parsePullRequestRef returns null when GITHUB_REPOSITORY is not set', () =>
  withEnv(
    {
      GITHUB_REPOSITORY: undefined,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: '/tmp/missing-event.json',
    },
    () => {
      assert.equal(parsePullRequestRef(), null)
    }
  ))

test('parsePullRequestRef returns null when GITHUB_EVENT_NAME is not pull_request', () => {
  const event = createEventFile({ pull_request: { number: 42 } })

  try {
    return withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
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

test('parsePullRequestRef returns the pull request reference when env vars are valid', () => {
  const event = createEventFile({ pull_request: { number: 42 } })

  try {
    return withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: event.path,
      },
      () => {
        assert.deepEqual(parsePullRequestRef(), {
          owner: 'acme',
          repo: 'import-cost-ci',
          issueNumber: 42,
        })
      }
    )
  } finally {
    rmSync(event.dir, { recursive: true, force: true })
  }
})

test('parsePullRequestRef returns null for push events', () => {
  const event = createEventFile({ ref: 'refs/heads/main' })

  try {
    return withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'push',
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

test('formatResultsMarkdown includes exceeded packages in the report', () => {
  const output = formatResultsMarkdown(
    [
      { pkg: 'left-pad|legacy', bytes: 51201, exceeded: true },
      { pkg: 'chalk', bytes: 700, exceeded: false },
    ],
    50_000
  )

  assert.match(output, /Limit: `48\.8 kB`/)
  assert.match(output, /\| `left-pad\\\|legacy` \| 50\.0 kB \| Exceeded \|/)
  assert.match(output, /1 import\(s\) exceeded the 48\.8 kB limit\./)
})

test('formatResultsMarkdown reports when all packages pass', () => {
  const output = formatResultsMarkdown(
    [
      { pkg: 'chalk', bytes: 700, exceeded: false },
      { pkg: 'commander', bytes: 1200, exceeded: false },
    ],
    50_000
  )

  assert.match(output, /\| `chalk` \| 700 B \| OK \|/)
  assert.match(output, /\| `commander` \| 1\.2 kB \| OK \|/)
  assert.match(output, /All imports are within the 48\.8 kB limit\./)
})

test('maybePostGitHubComment updates an existing import-cost-ci comment', async () => {
  const event = createEventFile({ pull_request: { number: 42 } })
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    requests.push({ url, init })

    if (requests.length === 1) {
      return new Response(JSON.stringify([{ id: 7, body: '<!-- import-cost-ci -->\nold body' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(null, { status: 204 })
  }

  try {
    await withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: event.path,
        GITHUB_TOKEN: 'test-token',
      },
      async () => {
        await maybePostGitHubComment([{ pkg: 'chalk', bytes: 700, exceeded: false }], 50_000)
      }
    )

    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, 'https://api.github.com/repos/acme/import-cost-ci/issues/42/comments')
    assert.equal(requests[0].init?.method, 'GET')
    assert.equal(requests[1].url, 'https://api.github.com/repos/acme/import-cost-ci/issues/comments/7')
    assert.equal(requests[1].init?.method, 'PATCH')
    assert.match(String(requests[1].init?.body), /<!-- import-cost-ci -->/)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(event.dir, { recursive: true, force: true })
  }
})

test('maybePostGitHubComment creates a new comment when no existing marker is found', async () => {
  const event = createEventFile({ pull_request: { number: 42 } })
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    requests.push({ url, init })

    if (requests.length === 1) {
      return new Response(JSON.stringify([{ id: 7, body: 'another bot comment' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ id: 8 }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await withEnv(
      {
        GITHUB_REPOSITORY: 'acme/import-cost-ci',
        GITHUB_EVENT_NAME: 'pull_request_target',
        GITHUB_EVENT_PATH: event.path,
        GITHUB_TOKEN: 'test-token',
      },
      async () => {
        await maybePostGitHubComment([{ pkg: 'chalk', bytes: 700, exceeded: false }], 50_000)
      }
    )

    assert.equal(requests.length, 2)
    assert.equal(requests[1].url, 'https://api.github.com/repos/acme/import-cost-ci/issues/42/comments')
    assert.equal(requests[1].init?.method, 'POST')
    assert.match(String(requests[1].init?.body), /## import-cost-ci report/)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(event.dir, { recursive: true, force: true })
  }
})
