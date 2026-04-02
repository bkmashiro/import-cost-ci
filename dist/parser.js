const IMPORT_PATTERNS = [
    // import ... from 'pkg'
    /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    // import('pkg')
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
export function extractImports(source) {
    const imports = new Set();
    for (const pattern of IMPORT_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = re.exec(source)) !== null) {
            const pkg = match[1];
            // Skip relative and absolute imports
            if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
                imports.add(pkg);
            }
        }
    }
    return Array.from(imports);
}
