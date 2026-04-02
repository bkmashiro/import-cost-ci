[![npm](https://img.shields.io/npm/v/import-cost-ci)](https://www.npmjs.com/package/import-cost-ci) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# import-cost-ci

> Know the bundle cost of your imports before CI catches you.

`import-cost-ci` analyzes every external import in a JS/TS file, bundles each one in isolation using esbuild, and reports the minified + gzip size. Fail your CI pipeline if any import exceeds your configured size budget.

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

## GitHub Actions

Use the published action directly:

```yaml
- name: Check import costs
  uses: yuzhva/import-cost-ci@v0
  with:
    file: src/main.ts
    limit: 50kb
```

The action posts or updates a PR comment automatically when it runs on a pull request and `GITHUB_TOKEN` is available.

Full workflow example:

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
