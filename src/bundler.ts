import zlib from 'zlib'
import os from 'os'
import path from 'path'
import fs from 'fs'

export type BundlerName = 'esbuild' | 'webpack' | 'vite' | 'rollup'

async function measureWithEsbuild(pkg: string): Promise<number> {
  const { default: esbuild } = await import('esbuild')
  const result = await esbuild.build({
    stdin: { contents: `import "${pkg}"`, loader: 'js', resolveDir: process.cwd() },
    bundle: true,
    minify: true,
    platform: 'browser',
    write: false,
    format: 'esm',
  })
  const code = result.outputFiles[0].contents
  return zlib.gzipSync(code).length
}

async function measureWithWebpack(pkg: string): Promise<number> {
  const [{ default: webpack }, { default: MemoryFs }] = await Promise.all([
    import('webpack'),
    import('memfs'),
  ])

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-cost-webpack-'))
  const entryFile = path.join(tmpDir, 'entry.js')
  fs.writeFileSync(entryFile, `import "${pkg}"`)

  try {
    const outputBuffer = await new Promise<Buffer>((resolve, reject) => {
      const vol = new (MemoryFs as any).Volume()
      const mfs = (MemoryFs as any).createFsFromVolume(vol)

      const compiler = webpack({
        entry: entryFile,
        mode: 'production',
        output: {
          path: '/out',
          filename: 'bundle.js',
          library: { type: 'module' },
        },
        experiments: { outputModule: true },
        optimization: { minimize: true },
      })

      compiler.outputFileSystem = mfs

      compiler.run((err: Error | null, stats: any) => {
        if (err) { compiler.close(() => {}); reject(err); return }
        if (stats?.hasErrors()) { compiler.close(() => {}); reject(new Error(stats.toString())); return }

        let buf: Buffer
        try {
          buf = mfs.readFileSync('/out/bundle.js') as Buffer
        } catch (e) {
          compiler.close(() => {}); reject(e); return
        }

        compiler.close((closeErr: Error | null | undefined) => {
          if (closeErr) { reject(closeErr); return }
          resolve(buf)
        })
      })
    })
    return zlib.gzipSync(outputBuffer).length
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function measureWithVite(pkg: string): Promise<number> {
  const { build } = await import('vite')

  const result = await build({
    build: {
      lib: {
        entry: `data:text/javascript,import "${pkg}"`,
        formats: ['es'],
        fileName: 'bundle',
      },
      minify: true,
      write: false,
      rollupOptions: { external: [] },
    },
    logLevel: 'silent',
  }) as any

  const output = Array.isArray(result) ? result[0].output : result.output
  if (!output || output.length === 0) {
    throw new Error(`Vite produced no output chunks for package: ${pkg}`)
  }
  const chunk = output.find((o: any) => o.type === 'chunk') ?? output[0]
  if (chunk.code == null && chunk.source == null) {
    throw new Error(`Vite produced no output chunks for package: ${pkg}`)
  }
  const code = chunk.code ?? chunk.source
  return zlib.gzipSync(Buffer.from(code)).length
}

async function measureWithRollup(pkg: string): Promise<number> {
  const { rollup } = await import('rollup')
  const { nodeResolve } = await import('@rollup/plugin-node-resolve')
  const terserMod = await import('@rollup/plugin-terser')
  const terser = (terserMod as any).default ?? terserMod

  const bundle = await rollup({
    input: 'virtual:entry',
    plugins: [
      {
        name: 'virtual-entry',
        resolveId(id: string) { if (id === 'virtual:entry') return id; return null },
        load(id: string) { if (id === 'virtual:entry') return `import "${pkg}"`; return null },
      },
      nodeResolve({ browser: true }),
      terser(),
    ],
  })

  const { output } = await bundle.generate({ format: 'esm' })
  await bundle.close()

  const code = output[0].code
  return zlib.gzipSync(Buffer.from(code)).length
}

/**
 * Bundles a single npm package in isolation and returns its gzip-compressed size in bytes.
 *
 * The package is bundled with minification enabled using the requested bundler, and the
 * resulting output is gzip-compressed before measuring. This approximates the
 * over-the-wire cost a browser pays when fetching the dependency.
 *
 * @param pkg - The npm package specifier to measure (e.g. `"lodash"`, `"react-dom"`).
 * @param bundler - The bundler to use for the build. Defaults to `"esbuild"`.
 *   Supported values: `"esbuild"`, `"webpack"`, `"vite"`, `"rollup"`.
 * @returns The gzip-compressed bundle size in bytes.
 * @throws {Error} If the bundler name is not one of the supported values, or if the
 *   underlying bundler tool throws during the build.
 */
export async function measureImportSize(pkg: string, bundler: BundlerName = 'esbuild'): Promise<number> {
  switch (bundler) {
    case 'esbuild':  return measureWithEsbuild(pkg)
    case 'webpack':  return measureWithWebpack(pkg)
    case 'vite':     return measureWithVite(pkg)
    case 'rollup':   return measureWithRollup(pkg)
    default:
      throw new Error(`Unknown bundler: ${bundler}. Supported: esbuild, webpack, vite, rollup`)
  }
}
