import assert from 'node:assert/strict'
import test from 'node:test'

import { parseLimit, getActionBoolean, applyGitHubActionInputs } from '../src/index-helpers.ts'

// ---------------------------------------------------------------------------
// parseLimit
// ---------------------------------------------------------------------------

test('parseLimit: bare number defaults to bytes', () => {
  assert.equal(parseLimit('500'), 500)
})

test('parseLimit: explicit b suffix', () => {
  assert.equal(parseLimit('256b'), 256)
})

test('parseLimit: kb suffix multiplies by 1000', () => {
  assert.equal(parseLimit('50kb'), 50_000)
})

test('parseLimit: KB suffix is case-insensitive', () => {
  assert.equal(parseLimit('50KB'), 50_000)
})

test('parseLimit: mb suffix multiplies by 1_000_000', () => {
  assert.equal(parseLimit('2mb'), 2_000_000)
})

test('parseLimit: MB suffix is case-insensitive', () => {
  assert.equal(parseLimit('1MB'), 1_000_000)
})

test('parseLimit: fractional kb rounds to nearest byte', () => {
  assert.equal(parseLimit('1.5kb'), 1500)
})

test('parseLimit: fractional mb rounds to nearest byte', () => {
  assert.equal(parseLimit('0.5mb'), 500_000)
})

test('parseLimit: throws on invalid unit', () => {
  assert.throws(() => parseLimit('50gb'), /Invalid size limit/)
})

test('parseLimit: throws on non-numeric input', () => {
  assert.throws(() => parseLimit('abc'), /Invalid size limit/)
})

test('parseLimit: throws on empty string', () => {
  assert.throws(() => parseLimit(''), /Invalid size limit/)
})

test('parseLimit: throws on negative value', () => {
  // Negative numbers do not match the regex (no leading minus allowed)
  assert.throws(() => parseLimit('-10kb'), /Invalid size limit/)
})

test('parseLimit: throws on value with spaces before unit when no match', () => {
  // Leading whitespace before the number is not allowed by the regex
  assert.throws(() => parseLimit(' 50kb'), /Invalid size limit/)
})

test('parseLimit: zero bytes is valid', () => {
  assert.equal(parseLimit('0'), 0)
})

// ---------------------------------------------------------------------------
// getActionBoolean
// ---------------------------------------------------------------------------

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const original = process.env[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
  try {
    fn()
  } finally {
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
}

test('getActionBoolean: returns fallback when env var is absent', () => {
  withEnv('INPUT_MY_FLAG', undefined, () => {
    assert.equal(getActionBoolean('my-flag', true), true)
    assert.equal(getActionBoolean('my-flag', false), false)
  })
})

test("getActionBoolean: 'true' returns true", () => {
  withEnv('INPUT_MY_FLAG', 'true', () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test("getActionBoolean: 'false' returns false", () => {
  withEnv('INPUT_MY_FLAG', 'false', () => {
    assert.equal(getActionBoolean('my-flag', true), false)
  })
})

test("getActionBoolean: '1' returns true (not 'false')", () => {
  withEnv('INPUT_MY_FLAG', '1', () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test("getActionBoolean: '0' returns true (not 'false')", () => {
  // Only the literal string 'false' (case-insensitive) maps to false
  withEnv('INPUT_MY_FLAG', '0', () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test("getActionBoolean: 'yes' returns true", () => {
  withEnv('INPUT_MY_FLAG', 'yes', () => {
    assert.equal(getActionBoolean('my-flag', false), true)
  })
})

test("getActionBoolean: 'FALSE' (uppercase) returns false", () => {
  withEnv('INPUT_MY_FLAG', 'FALSE', () => {
    assert.equal(getActionBoolean('my-flag', true), false)
  })
})

test("getActionBoolean: 'False' (mixed-case) returns false", () => {
  withEnv('INPUT_MY_FLAG', 'False', () => {
    assert.equal(getActionBoolean('my-flag', true), false)
  })
})

test('getActionBoolean: converts hyphenated name to INPUT_SNAKE_CASE key', () => {
  withEnv('INPUT_NO_FAIL', 'false', () => {
    assert.equal(getActionBoolean('no-fail', true), false)
  })
})

// ---------------------------------------------------------------------------
// applyGitHubActionInputs
// ---------------------------------------------------------------------------

function withCleanEnv(overrides: Record<string, string>, fn: (originalArgv: string[]) => void): void {
  const originalArgv = process.argv.slice()

  const actionKeys = ['INPUT_FILE', 'INPUT_LIMIT', 'INPUT_NO_FAIL', 'INPUT_TREEMAP', 'INPUT_HISTORY']
  const savedEnv: Record<string, string | undefined> = {}

  for (const key of [...actionKeys, ...Object.keys(overrides)]) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value
  }

  // Suppress shouldAutoEnableHistory's GitHub env triggers
  const savedEvent = process.env.GITHUB_EVENT_NAME
  delete process.env.GITHUB_EVENT_NAME

  try {
    fn(originalArgv)
  } finally {
    process.argv = originalArgv
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    if (savedEvent === undefined) {
      delete process.env.GITHUB_EVENT_NAME
    } else {
      process.env.GITHUB_EVENT_NAME = savedEvent
    }
  }
}

test('applyGitHubActionInputs: does nothing when INPUT_FILE is absent', () => {
  withCleanEnv({}, (originalArgv) => {
    applyGitHubActionInputs()
    assert.deepEqual(process.argv, originalArgv)
  })
})

test('applyGitHubActionInputs: sets argv to [node, script, file] for minimal input', () => {
  withCleanEnv({ INPUT_FILE: 'src/app.ts' }, () => {
    applyGitHubActionInputs()
    assert.equal(process.argv[2], 'src/app.ts')
    assert.equal(process.argv.length, 3)
  })
})

test('applyGitHubActionInputs: appends --limit when INPUT_LIMIT is set', () => {
  withCleanEnv({ INPUT_FILE: 'src/app.ts', INPUT_LIMIT: '50kb' }, () => {
    applyGitHubActionInputs()
    assert.ok(process.argv.includes('--limit'))
    assert.equal(process.argv[process.argv.indexOf('--limit') + 1], '50kb')
  })
})

test('applyGitHubActionInputs: appends --no-fail when INPUT_NO_FAIL is true', () => {
  withCleanEnv({ INPUT_FILE: 'src/app.ts', INPUT_NO_FAIL: 'true' }, () => {
    applyGitHubActionInputs()
    assert.ok(process.argv.includes('--no-fail'))
  })
})

test('applyGitHubActionInputs: does not append --no-fail when INPUT_NO_FAIL is false', () => {
  withCleanEnv({ INPUT_FILE: 'src/app.ts', INPUT_NO_FAIL: 'false' }, () => {
    applyGitHubActionInputs()
    assert.ok(!process.argv.includes('--no-fail'))
  })
})

test('applyGitHubActionInputs: appends --treemap when INPUT_TREEMAP is true', () => {
  withCleanEnv({ INPUT_FILE: 'src/app.ts', INPUT_TREEMAP: 'true' }, () => {
    applyGitHubActionInputs()
    assert.ok(process.argv.includes('--treemap'))
  })
})

test('applyGitHubActionInputs: appends --history when INPUT_HISTORY is true', () => {
  withCleanEnv({ INPUT_FILE: 'src/app.ts', INPUT_HISTORY: 'true' }, () => {
    applyGitHubActionInputs()
    assert.ok(process.argv.includes('--history'))
  })
})

test('applyGitHubActionInputs: all flags combined produce correct argv', () => {
  withCleanEnv(
    {
      INPUT_FILE: 'src/app.ts',
      INPUT_LIMIT: '100kb',
      INPUT_NO_FAIL: 'true',
      INPUT_TREEMAP: 'true',
      INPUT_HISTORY: 'true',
    },
    () => {
      applyGitHubActionInputs()
      assert.equal(process.argv[2], 'src/app.ts')
      assert.ok(process.argv.includes('--limit'))
      assert.ok(process.argv.includes('--no-fail'))
      assert.ok(process.argv.includes('--treemap'))
      assert.ok(process.argv.includes('--history'))
    }
  )
})

test('applyGitHubActionInputs: preserves argv[0] and argv[1] (node and script path)', () => {
  const [node, script] = process.argv
  withCleanEnv({ INPUT_FILE: 'src/app.ts' }, () => {
    applyGitHubActionInputs()
    assert.equal(process.argv[0], node)
    assert.equal(process.argv[1], script)
  })
})
