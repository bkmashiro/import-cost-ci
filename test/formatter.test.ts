import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSummaryLine, formatResultsMarkdown, formatSize } from '../src/formatter.ts'

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

test('builds a passing summary line', () => {
  assert.equal(buildSummaryLine(0, 50_000), 'All imports are within the 48.8 kB limit.')
})

test('renders markdown table output', () => {
  const output = formatResultsMarkdown(
    [
      { pkg: 'react', bytes: 2400, exceeded: false },
      { pkg: 'moment', bytes: 72100, exceeded: true },
    ],
    50_000
  )

  assert.match(output, /\| `react` \| 2\.3 kB \| OK \|/)
  assert.match(output, /\| `moment` \| 70\.4 kB \| Exceeded \|/)
  assert.match(output, /1 import\(s\) exceeded the 48\.8 kB limit\./)
})
