[![npm](https://img.shields.io/npm/v/import-cost-ci)](https://www.npmjs.com/package/import-cost-ci) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# import-cost-ci

> Know the bundle cost of your imports before CI catches you.

`import-cost-ci` analyzes every external import in a JS/TS file, bundles each one in isolation, and reports the minified + gzip size. Fail your CI pipeline if any import exceeds your configured size budget. Supports esbuild (default), webpack, vite, and rollup as the bundler back-end.

## Install

```bash
npm install -g import-cost-ci
```

## Usage

```bash
import-cost-ci <file> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--limit <size>` | Size limit (e.g. `50kb`, `100kb`, `500b`) | `100kb` |
| `--json` | Output as JSON (for CI integration) | false |
| `--no-fail` | Report violations but don't exit 1 | false |
| `--ignore <pkgs>` | Comma-separated packages to skip | — |
| `--treemap` | Print a 20-column import size treemap with the top 10 packages | false |
| `--bundler <name>` | Bundler to use: `esbuild`, `webpack`, `vite`, or `rollup` | `esbuild` |
| `--history` | Persist bundle history to `.import-cost-history.json` and print the trend | false |

### Example

```bash
$ import-cost-ci src/main.ts --limit 50kb
✓ react                2.4 kB
✓ lodash/merge         1.2 kB
✗ moment               72.1 kB  ← exceeds 50kb limit!
✓ axios                12.3 kB

1 import(s) exceeded the 50kb limit.
```

### JSON output

```bash
$ import-cost-ci src/main.ts --limit 50kb --json
{
  "limit": 50000,
  "results": [
    { "pkg": "react", "bytes": 2400, "size": "2.4 kB", "exceeded": false },
    { "pkg": "moment", "bytes": 72100, "size": "72.1 kB", "exceeded": true }
  ],
  "violations": 1
}
```

### Ignore specific packages

```bash
import-cost-ci src/main.ts --limit 50kb --ignore moment,lodash
```

### Treemap output

```bash
import-cost-ci src/main.ts --treemap
```

### History tracking

```bash
import-cost-ci src/main.ts --history
```

History is written to `.import-cost-history.json` in the current working directory. In GitHub Actions, history is enabled automatically on `push` runs to `main`.

### Choosing a bundler

By default `import-cost-ci` uses **esbuild**, which is the fastest option. Use `--bundler` to switch to webpack, vite, or rollup when you want measurements that match your actual build pipeline:

```bash
# esbuild (default) — fastest, great for everyday CI checks
import-cost-ci src/main.ts --limit 50kb

# webpack — matches a webpack-based app
import-cost-ci src/main.ts --bundler webpack --limit 50kb

# vite — matches a Vite-based app
import-cost-ci src/main.ts --bundler vite --limit 50kb

# rollup — matches a rollup-based library
import-cost-ci src/main.ts --bundler rollup --limit 50kb
```

Each bundler produces a minified, gzip-compressed measurement. Results will differ slightly between bundlers due to differences in tree-shaking and output format — pick the one that matches your production build for the most accurate numbers.

#### Bundler configuration notes

| Bundler | Config used by import-cost-ci |
|---------|-------------------------------|
| **esbuild** | `bundle: true`, `minify: true`, `platform: browser`, `format: esm` |
| **webpack** | `mode: production`, ESM library output (`experiments.outputModule`), memory FS output |
| **vite** | library mode, `formats: ['es']`, `minify: true`, no external packages |
| **rollup** | `@rollup/plugin-node-resolve` (browser), `@rollup/plugin-terser`, `format: esm` |

## GitHub Actions

Use the published action directly:

```yaml
- name: Check import costs
  uses: yuzhva/import-cost-ci@v0
  with:
    file: src/main.ts
    limit: 50kb
    bundler: esbuild   # esbuild (default) | webpack | vite | rollup
    treemap: true
    history: true
```

The action posts or updates a PR comment automatically when it runs on a pull request and `GITHUB_TOKEN` is available.

Full workflow example (esbuild, default):

```yaml
name: Import Cost Check
on: [push, pull_request]

jobs:
  import-cost:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Check import costs
        uses: yuzhva/import-cost-ci@v0
        with:
          file: src/main.ts
          limit: 50kb
          # bundler: esbuild  ← default, fastest
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

webpack example (for webpack-based projects):

```yaml
      - name: Check import costs (webpack)
        uses: yuzhva/import-cost-ci@v0
        with:
          file: src/main.ts
          limit: 50kb
          bundler: webpack
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

vite example (for Vite-based projects):

```yaml
      - name: Check import costs (vite)
        uses: yuzhva/import-cost-ci@v0
        with:
          file: src/main.ts
          limit: 50kb
          bundler: vite
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

rollup example (for rollup-based libraries):

```yaml
      - name: Check import costs (rollup)
        uses: yuzhva/import-cost-ci@v0
        with:
          file: src/main.ts
          limit: 50kb
          bundler: rollup
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## How it works

1. **Parse** — extracts all external `import` statements (static and dynamic) from the file using regex. Relative and absolute imports are skipped.
2. **Bundle** — each package is bundled in isolation using the esbuild JavaScript API with `bundle: true`, `minify: true`, targeting the browser.
3. **Measure** — the output is gzip-compressed and the byte count is recorded.
4. **Report** — results are printed with color-coded pass/fail indicators. Exceeding the limit causes exit code 1 (unless `--no-fail` is set).

## License

MIT
