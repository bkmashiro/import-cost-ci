import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCommentBody } from '../src/github-comment.ts'

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
