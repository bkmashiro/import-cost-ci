const IMPORT_PATTERNS = [
  // import ... from 'pkg' (optional assert { ... } block)
  /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"\\]*(?:\\.[^'"\\]*)*)['"](?:\s*assert\s*\{[^}]*\})?/g,
  // import('pkg')
  /import\s*\(\s*['"]([^'"\\]*(?:\\.[^'"\\]*)*)['\"]\s*\)/g,
]

const ASSERT_BLOCK_RE = /\s*assert\s*\{[^}]*\}$/

function normalizePackageName(raw: string): string {
  return raw.replace(ASSERT_BLOCK_RE, '').replace(/\\(.)/g, '$1')
}

/**
 * Extracts all third-party package names from a TypeScript/JavaScript source string.
 *
 * Recognises both static (`import ... from 'pkg'`) and dynamic (`import('pkg')`)
 * import forms. Relative and absolute path imports (starting with `.` or `/`) are
 * excluded — only bare package specifiers are returned.
 *
 * @param source - The full source text to scan for import statements.
 * @returns A deduplicated array of package specifier strings, in encounter order.
 */
export function extractImports(source: string): string[] {
  const imports = new Set<string>()

  for (const pattern of IMPORT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      const pkg = normalizePackageName(match[1])
      // Skip relative and absolute imports
      if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
        imports.add(pkg)
      }
    }
  }

  return Array.from(imports)
}
