import assert from 'node:assert/strict'
import test from 'node:test'

import { getActionBoolean, parseLimit } from '../src/cli-utils.ts'

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key]
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

// parseLimit

test('parseLimit parses a bare number as bytes', () => {
  assert.equal(parseLimit('100'), 100)
})

test('parseLimit parses bytes with explicit b suffix', () => {
  assert.equal(parseLimit('50b'), 50)
})

test('parseLimit parses kilobytes', () => {
  assert.equal(parseLimit('50kb'), 50_000)
})

test('parseLimit parses megabytes', () => {
  assert.equal(parseLimit('2mb'), 2_000_000)
})

test('parseLimit parses fractional kilobytes and rounds', () => {
  assert.equal(parseLimit('1.5kb'), 1500)
})

test('parseLimit is case-insensitive for units', () => {
  assert.equal(parseLimit('10KB'), 10_000)
  assert.equal(parseLimit('1MB'), 1_000_000)
})

test('parseLimit throws for empty string', () => {
  assert.throws(() => parseLimit(''), /Invalid size limit/)
})

test('parseLimit throws for negative numbers', () => {
  assert.throws(() => parseLimit('-10kb'), /Invalid size limit/)
})

test('parseLimit throws for unsupported units', () => {
  assert.throws(() => parseLimit('10gb'), /Invalid size limit/)
  assert.throws(() => parseLimit('10tb'), /Invalid size limit/)
})

test('parseLimit throws for non-numeric input', () => {
  assert.throws(() => parseLimit('big'), /Invalid size limit/)
})

// getActionBoolean

test('getActionBoolean returns fallback when env var is not set', () => {
  withEnv({ INPUT_MY_FLAG: undefined }, () => {
    assert.equal(getActionBoolean('my-flag', true), true)
    assert.equal(getActionBoolean('my-flag', false), false)
  })
})

test('getActionBoolean returns true when env var is "true"', () => {
  withEnv({ INPUT_MY_FLAG: 'true' }, () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test('getActionBoolean returns false when env var is "false"', () => {
  withEnv({ INPUT_MY_FLAG: 'false' }, () => {
    assert.equal(getActionBoolean('my-flag', true), false)
  })
})

test('getActionBoolean is case-insensitive for "false"', () => {
  withEnv({ INPUT_MY_FLAG: 'FALSE' }, () => {
    assert.equal(getActionBoolean('my-flag', true), false)
  })
})

test('getActionBoolean treats any non-false value as true', () => {
  withEnv({ INPUT_MY_FLAG: 'yes' }, () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test('getActionBoolean converts kebab-case name to SCREAMING_SNAKE_CASE env key', () => {
  withEnv({ INPUT_NO_FAIL: 'true' }, () => {
    assert.equal(getActionBoolean('no-fail', false), true)
  })
})
