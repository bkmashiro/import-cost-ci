import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  formatHistoryReport,
  getHistoryFilePath,
  loadHistory,
  saveHistoryEntry,
  shouldAutoEnableHistory,
} from '../src/history.ts'

function withEnv(
  overrides: Partial<Record<'GITHUB_EVENT_NAME' | 'GITHUB_EVENT_PATH', string | undefined>>,
  fn: () => void
): void {
  const previous = {
    GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
    GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH,
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('saveHistoryEntry writes the latest 30 entries and sorts packages by size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-'))

  try {
    for (let index = 0; index < 31; index += 1) {
      saveHistoryEntry(
        [
          { pkg: 'small', bytes: 100 + index, exceeded: false },
          { pkg: 'big', bytes: 300 + index, exceeded: false },
        ],
        dir,
        `2024-03-${String(index + 1).padStart(2, '0')}`
      )
    }

    const history = loadHistory(dir)
    assert.equal(history.length, 30)
    assert.equal(history[0].date, '2024-03-31')
    assert.equal(history[29].date, '2024-03-02')
    assert.deepEqual(history[0].packages[0], { name: 'big', size: 330 })

    const file = JSON.parse(readFileSync(getHistoryFilePath(dir), 'utf8')) as {
      entries: Array<{ date: string }>
    }
    assert.equal(file.entries.length, 30)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('formatHistoryReport shows historical deltas and weekly trend', () => {
  const output = formatHistoryReport([
    { date: '2024-03-20', totalSize: 145_000, packages: [] },
    { date: '2024-03-18', totalSize: 140_000, packages: [] },
    { date: '2024-03-15', totalSize: 142_000, packages: [] },
    { date: '2024-03-10', totalSize: 135_000, packages: [] },
  ])

  assert.match(output, /^Current: 141\.6 kB/m)
  assert.match(output, /2024-03-18  136\.7 kB  ▲ \+4\.9kb/)
  assert.match(output, /2024-03-15  138\.7 kB  ▼ -2kb/)
  assert.match(output, /Trend: \+6\.8kb\/week \(growing\)/)
})

test('loadHistory skips entries with malformed date strings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-'))

  try {
    const historyPath = getHistoryFilePath(dir)
    writeFileSync(
      historyPath,
      JSON.stringify({
        entries: [
          { date: '2024-03-20', totalSize: 1000, packages: [] },
          { date: 'not-a-date', totalSize: 2000, packages: [] },
          { date: '2024-03-18', totalSize: 900, packages: [] },
        ],
      }) + '\n'
    )

    const history = loadHistory(dir)
    assert.equal(history.length, 2)
    assert.equal(history[0].date, '2024-03-20')
    assert.equal(history[1].date, '2024-03-18')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadHistory returns empty array for malformed JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-'))

  try {
    writeFileSync(getHistoryFilePath(dir), '{"entries": [truncated')
    assert.deepEqual(loadHistory(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadHistory returns empty array for empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-'))

  try {
    writeFileSync(getHistoryFilePath(dir), '')
    assert.deepEqual(loadHistory(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadHistory returns empty array for JSON that is not an object or array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-'))

  try {
    writeFileSync(getHistoryFilePath(dir), '"just a string"')
    assert.deepEqual(loadHistory(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadHistory skips malformed entries and returns only valid ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-'))

  try {
    const content = JSON.stringify({
      entries: [
        { date: '2024-03-20', totalSize: 1000, packages: [{ name: 'lodash', size: 1000 }] },
        { date: null, totalSize: 'bad', packages: [] },
        null,
        { date: '2024-03-18', totalSize: 800, packages: [] },
      ],
    })
    writeFileSync(getHistoryFilePath(dir), content)

    const history = loadHistory(dir)
    assert.equal(history.length, 2)
    assert.equal(history[0].date, '2024-03-20')
    assert.equal(history[1].date, '2024-03-18')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('formatHistoryReport with malformed date produces no NaN output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-'))

  try {
    const historyPath = getHistoryFilePath(dir)
    writeFileSync(
      historyPath,
      JSON.stringify({
        entries: [
          { date: '2024-03-20', totalSize: 1000, packages: [] },
          { date: 'not-a-date', totalSize: 2000, packages: [] },
        ],
      }) + '\n'
    )

    const history = loadHistory(dir)
    const report = formatHistoryReport(history)
    assert.doesNotMatch(report, /NaN/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('shouldAutoEnableHistory detects pushes to main from the GitHub event payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-event-'))
  const eventPath = join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify({ ref: 'refs/heads/main' }))

  try {
    withEnv(
      {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
      },
      () => {
        assert.equal(shouldAutoEnableHistory(), true)
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('shouldAutoEnableHistory ignores non-main refs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-cost-history-event-'))
  const eventPath = join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify({ ref: 'refs/heads/feature' }))

  try {
    withEnv(
      {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
      },
      () => {
        assert.equal(shouldAutoEnableHistory(), false)
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
