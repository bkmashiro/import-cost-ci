import assert from 'node:assert/strict'
import test from 'node:test'

import { parseLimit, getActionBoolean } from '../src/helpers.ts'
import { sanitizeHistoryEntry, formatSignedKb, describeTrend } from '../src/history.ts'
import { escapeMarkdownCell } from '../src/formatter.ts'

// parseLimit

test('parseLimit parses bare bytes', () => {
  assert.equal(parseLimit('500'), 500)
})

test('parseLimit parses bytes with explicit b unit', () => {
  assert.equal(parseLimit('100b'), 100)
})

test('parseLimit parses kb unit', () => {
  assert.equal(parseLimit('50kb'), 50_000)
})

test('parseLimit parses KB unit (case-insensitive)', () => {
  assert.equal(parseLimit('50KB'), 50_000)
})

test('parseLimit parses mb unit', () => {
  assert.equal(parseLimit('1mb'), 1_000_000)
})

test('parseLimit parses fractional kb', () => {
  assert.equal(parseLimit('1.5kb'), 1500)
})

test('parseLimit throws on missing unit when input is alphabetic', () => {
  assert.throws(() => parseLimit('50xyz'), /Invalid size limit/)
})

test('parseLimit throws on empty string', () => {
  assert.throws(() => parseLimit(''), /Invalid size limit/)
})

test('parseLimit throws on negative value', () => {
  assert.throws(() => parseLimit('-10kb'), /Invalid size limit/)
})

test('parseLimit parses zero bytes', () => {
  assert.equal(parseLimit('0'), 0)
})

test('parseLimit parses zero kb', () => {
  assert.equal(parseLimit('0kb'), 0)
})

test('parseLimit throws on unit with no value', () => {
  assert.throws(() => parseLimit('kb'), /Invalid size limit/)
})

// getActionBoolean

function withInputEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const keys = Object.keys(overrides)
  const previous: Record<string, string | undefined> = {}

  for (const key of keys) {
    previous[key] = process.env[key]
    if (overrides[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = overrides[key]
    }
  }

  try {
    fn()
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous[key]
      }
    }
  }
}

test('getActionBoolean returns fallback when env var is not set', () => {
  withInputEnv({ INPUT_MY_FLAG: undefined }, () => {
    assert.equal(getActionBoolean('my-flag', true), true)
    assert.equal(getActionBoolean('my-flag', false), false)
  })
})

test('getActionBoolean returns fallback when env var is empty string', () => {
  withInputEnv({ INPUT_MY_FLAG: '' }, () => {
    assert.equal(getActionBoolean('my-flag', true), true)
  })
})

test('getActionBoolean returns true for value "true"', () => {
  withInputEnv({ INPUT_MY_FLAG: 'true' }, () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test('getActionBoolean returns false for value "false"', () => {
  withInputEnv({ INPUT_MY_FLAG: 'false' }, () => {
    assert.equal(getActionBoolean('my-flag', true), false)
  })
})

test('getActionBoolean returns false for value "FALSE" (case-insensitive)', () => {
  withInputEnv({ INPUT_MY_FLAG: 'FALSE' }, () => {
    assert.equal(getActionBoolean('my-flag', true), false)
  })
})

test('getActionBoolean returns true for any non-false truthy string', () => {
  withInputEnv({ INPUT_MY_FLAG: 'yes' }, () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test('getActionBoolean normalises hyphenated names to underscores', () => {
  withInputEnv({ INPUT_NO_FAIL: 'false' }, () => {
    assert.equal(getActionBoolean('no-fail', true), false)
  })
})

// sanitizeHistoryEntry

test('sanitizeHistoryEntry returns null for null input', () => {
  assert.equal(sanitizeHistoryEntry(null), null)
})

test('sanitizeHistoryEntry returns null for undefined input', () => {
  assert.equal(sanitizeHistoryEntry(undefined), null)
})

test('sanitizeHistoryEntry returns null when date is missing', () => {
  assert.equal(sanitizeHistoryEntry({ totalSize: 100, packages: [] }), null)
})

test('sanitizeHistoryEntry returns null when totalSize is not a number', () => {
  assert.equal(sanitizeHistoryEntry({ date: '2024-01-01', totalSize: '100' as unknown as number, packages: [] }), null)
})

test('sanitizeHistoryEntry returns null when packages is not an array', () => {
  assert.equal(sanitizeHistoryEntry({ date: '2024-01-01', totalSize: 100, packages: null as unknown as [] }), null)
})

test('sanitizeHistoryEntry filters out malformed package entries', () => {
  const result = sanitizeHistoryEntry({
    date: '2024-01-01',
    totalSize: 500,
    packages: [
      { name: 'react', size: 300 },
      null as unknown as { name: string; size: number },
      { name: 42 as unknown as string, size: 200 },
      { name: 'lodash', size: 200 },
    ],
  })

  assert.ok(result !== null)
  assert.equal(result.packages.length, 2)
  assert.deepEqual(result.packages[0], { name: 'react', size: 300 })
  assert.deepEqual(result.packages[1], { name: 'lodash', size: 200 })
})

test('sanitizeHistoryEntry returns valid entry unchanged', () => {
  const result = sanitizeHistoryEntry({
    date: '2024-03-15',
    totalSize: 1024,
    packages: [{ name: 'chalk', size: 1024 }],
  })

  assert.ok(result !== null)
  assert.equal(result.date, '2024-03-15')
  assert.equal(result.totalSize, 1024)
  assert.deepEqual(result.packages, [{ name: 'chalk', size: 1024 }])
})

test('sanitizeHistoryEntry strips extra properties from packages', () => {
  const result = sanitizeHistoryEntry({
    date: '2024-01-01',
    totalSize: 100,
    packages: [{ name: 'pkg', size: 100, extra: 'ignored' } as unknown as { name: string; size: number }],
  })

  assert.ok(result !== null)
  assert.deepEqual(result.packages[0], { name: 'pkg', size: 100 })
})

// formatSignedKb

test('formatSignedKb formats positive bytes as +kb', () => {
  assert.equal(formatSignedKb(1024), '+1kb')
})

test('formatSignedKb formats negative bytes as -kb', () => {
  assert.equal(formatSignedKb(-1024), '-1kb')
})

test('formatSignedKb formats fractional kb with one decimal', () => {
  assert.equal(formatSignedKb(1536), '+1.5kb')
})

test('formatSignedKb formats negative fractional kb', () => {
  assert.equal(formatSignedKb(-1536), '-1.5kb')
})

test('formatSignedKb formats zero as +0kb', () => {
  assert.equal(formatSignedKb(0), '+0kb')
})

test('formatSignedKb omits decimal for whole kb values', () => {
  assert.equal(formatSignedKb(2048), '+2kb')
})

test('formatSignedKb rounds to one decimal place', () => {
  // 1000 bytes = 0.9765625 kb → rounds to 1.0 → integer → no decimal
  assert.equal(formatSignedKb(1000), '+1kb')
})

test('formatSignedKb handles small non-zero byte values below 1kb', () => {
  // 100 bytes = 0.09765625 kb → rounds to 0.1
  assert.equal(formatSignedKb(100), '+0.1kb')
})

// describeTrend

test('describeTrend returns "stable" when bytesPerWeek is zero', () => {
  assert.equal(describeTrend(0), 'stable')
})

test('describeTrend returns "stable" when absolute value is below 1', () => {
  assert.equal(describeTrend(0.5), 'stable')
  assert.equal(describeTrend(-0.9), 'stable')
})

test('describeTrend returns "growing" for positive bytesPerWeek >= 1', () => {
  assert.equal(describeTrend(1), 'growing')
  assert.equal(describeTrend(10_000), 'growing')
})

test('describeTrend returns "shrinking" for negative bytesPerWeek <= -1', () => {
  assert.equal(describeTrend(-1), 'shrinking')
  assert.equal(describeTrend(-10_000), 'shrinking')
})

// escapeMarkdownCell

test('escapeMarkdownCell leaves strings without pipes unchanged', () => {
  assert.equal(escapeMarkdownCell('react'), 'react')
})

test('escapeMarkdownCell escapes a single pipe', () => {
  assert.equal(escapeMarkdownCell('a|b'), 'a\\|b')
})

test('escapeMarkdownCell escapes multiple pipes', () => {
  assert.equal(escapeMarkdownCell('a|b|c'), 'a\\|b\\|c')
})

test('escapeMarkdownCell handles a string that is only a pipe', () => {
  assert.equal(escapeMarkdownCell('|'), '\\|')
})

test('escapeMarkdownCell handles empty string', () => {
  assert.equal(escapeMarkdownCell(''), '')
})

test('escapeMarkdownCell handles pipe at start and end', () => {
  assert.equal(escapeMarkdownCell('|pkg|'), '\\|pkg\\|')
})

test('escapeMarkdownCell preserves other special characters', () => {
  assert.equal(escapeMarkdownCell('@scope/pkg'), '@scope/pkg')
  assert.equal(escapeMarkdownCell('`code`'), '`code`')
})
