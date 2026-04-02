import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { extractImports } from '../src/parser.ts'

const sampleSource = readFileSync(new URL('./fixtures/sample.ts', import.meta.url), 'utf8')
const dynamicSource = readFileSync(new URL('./fixtures/sample-dynamic.ts', import.meta.url), 'utf8')

test('extracts default imports from fixtures', () => {
  const imports = extractImports(sampleSource)

  assert.ok(imports.includes('react'))
  assert.ok(imports.includes('axios'))
})

test('extracts namespace imports from fixtures', () => {
  const imports = extractImports(sampleSource)

  assert.ok(imports.includes('lodash'))
})

test('extracts named imports from multiline fixtures', () => {
  const imports = extractImports(dynamicSource)

  assert.ok(imports.includes('react'))
})

test('extracts side-effect imports from fixtures', () => {
  const imports = extractImports(dynamicSource)

  assert.ok(imports.includes('side-effect-pkg'))
})

test('extracts dynamic imports from fixtures', () => {
  const imports = extractImports(dynamicSource)

  assert.ok(imports.includes('some-pkg'))
})

test('ignores relative imports from fixtures', () => {
  const imports = extractImports(sampleSource)

  assert.ok(!imports.includes('./local'))
})

test('ignores parent-relative imports from fixtures', () => {
  const imports = extractImports(sampleSource)

  assert.ok(!imports.includes('../parent'))
})

test('handles multiline imports from fixtures', () => {
  const imports = extractImports(dynamicSource)

  assert.deepEqual(imports, ['react', 'side-effect-pkg', 'some-pkg'])
})

test('returns package names only for named imports', () => {
  const imports = extractImports(dynamicSource)

  assert.ok(!imports.includes('{ useState }'))
  assert.equal(imports[0], 'react')
})

test('deduplicates repeated imports of the same package', () => {
  const imports = extractImports(dynamicSource)

  assert.equal(imports.filter((pkg) => pkg === 'some-pkg').length, 1)
})
