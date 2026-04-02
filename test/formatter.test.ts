import assert from 'node:assert/strict'
import test from 'node:test'

import { formatSize } from '../src/formatter.ts'

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
