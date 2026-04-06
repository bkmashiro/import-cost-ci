import zlib from 'zlib'
import os from 'os'
import path from 'path'
import fs from 'fs'

export type BundlerName = 'esbuild' | 'webpack' | 'vite' | 'rollup'

async function measureWithEsbuild(pkg: string): Promise<number> {
  const { default: esbuild } = await import('esbuild')
  const result = await esbuild.build({
    stdin: { contents: `import "${pkg}"`, loader: 'js' },
    bundle: true,
    minify: true,
    platform: 'browser',
    write: false,
    format: 'esm',
  })
  if (!result.outputFiles?.length) throw new Error('esbuild returned no output files')
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
        if (err) { reject(err); return }
        if (stats?.hasErrors()) { reject(new Error(stats.toString())); return }
        try {
          const buf = mfs.readFileSync('/out/bundle.js') as Buffer
          resolve(buf)
        } catch (e) {
          reject(e)
        }
        compiler.close(() => {})
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
  const chunk = output.find((o: any) => o.type === 'chunk') ?? output[0]
  const code = chunk.code ?? chunk.source ?? ''
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

  if (!output.length) throw new Error('rollup returned no output chunks')
  const chunk = output[0]
  if (chunk.type !== 'chunk') throw new Error('rollup output[0] is not a chunk')
  if (!chunk.code) throw new Error('rollup chunk has no code')
  return zlib.gzipSync(Buffer.from(chunk.code)).length
}

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
