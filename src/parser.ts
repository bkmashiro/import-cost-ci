const IMPORT_PATTERNS = [
  // import ... from 'pkg'
  /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
  // import('pkg')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/**
 * Extracts all third-party package names from a source file's import statements.
 *
 * Handles both static (`import ... from 'pkg'`) and dynamic (`import('pkg')`)
 * import syntax. Relative (`./`) and absolute (`/`) import paths are skipped.
 * Scoped packages (e.g. `@scope/pkg`) and bare specifiers are included.
 *
 * @param source - The raw source file content to parse.
 * @returns A deduplicated array of package names found in the source.
 */
export function extractImports(source: string): string[] {
  const imports = new Set<string>()

  for (const pattern of IMPORT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      const pkg = match[1]
      // Skip relative and absolute imports
      if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
        imports.add(pkg)
      }
    }
  }

  return Array.from(imports)
}
