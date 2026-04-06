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

test('handles TypeScript import assertion on static import', () => {
  const source = `import data from 'json-pkg' assert { type: 'json' }`
  const imports = extractImports(source)

  assert.deepEqual(imports, ['json-pkg'])
})

test('handles TypeScript import assertion with double quotes', () => {
  const source = `import data from "json-pkg" assert { type: "json" }`
  const imports = extractImports(source)

  assert.deepEqual(imports, ['json-pkg'])
})

test('does not include assert block content as a package name', () => {
  const source = `import data from 'json-pkg' assert { type: 'json' }`
  const imports = extractImports(source)

  assert.ok(!imports.some((pkg) => pkg.includes('assert')))
  assert.ok(!imports.some((pkg) => pkg.includes('type')))
  assert.equal(imports.length, 1)
})

test('handles escaped quote inside dynamic import path', () => {
  const source = `import("pack\\"age")`
  const imports = extractImports(source)

  assert.deepEqual(imports, ['pack"age'])
})

test('handles escaped quote inside static import path', () => {
  const source = `import something from 'pack\\'age'`
  const imports = extractImports(source)

  assert.deepEqual(imports, ["pack'age"])
})

test('handles import assertion alongside named imports', () => {
  const source = `import { foo, bar } from 'my-pkg' assert { type: 'json' }`
  const imports = extractImports(source)

  assert.deepEqual(imports, ['my-pkg'])
})
