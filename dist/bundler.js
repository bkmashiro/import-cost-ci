import zlib from 'zlib';
import os from 'os';
import path from 'path';
import fs from 'fs';
async function measureWithEsbuild(pkg) {
    const { default: esbuild } = await import('esbuild');
    const result = await esbuild.build({
        stdin: { contents: `import "${pkg}"`, loader: 'js' },
        bundle: true,
        minify: true,
        platform: 'browser',
        write: false,
        format: 'esm',
    });
    const code = result.outputFiles[0].contents;
    return zlib.gzipSync(code).length;
}
async function measureWithWebpack(pkg) {
    const [{ default: webpack }, { default: MemoryFs }] = await Promise.all([
        import('webpack'),
        import('memfs'),
    ]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-cost-webpack-'));
    const entryFile = path.join(tmpDir, 'entry.js');
    fs.writeFileSync(entryFile, `import "${pkg}"`);
    try {
        const outputBuffer = await new Promise((resolve, reject) => {
            const vol = new MemoryFs.Volume();
            const mfs = MemoryFs.createFsFromVolume(vol);
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
            });
            compiler.outputFileSystem = mfs;
            compiler.run((err, stats) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (stats?.hasErrors()) {
                    reject(new Error(stats.toString()));
                    return;
                }
                try {
                    const buf = mfs.readFileSync('/out/bundle.js');
                    resolve(buf);
                }
                catch (e) {
                    reject(e);
                }
                compiler.close(() => { });
            });
        });
        return zlib.gzipSync(outputBuffer).length;
    }
    finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
async function measureWithVite(pkg) {
    const { build } = await import('vite');
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
    });
    const output = Array.isArray(result) ? result[0].output : result.output;
    const chunk = output.find((o) => o.type === 'chunk') ?? output[0];
    const code = chunk.code ?? chunk.source ?? '';
    return zlib.gzipSync(Buffer.from(code)).length;
}
async function measureWithRollup(pkg) {
    const { rollup } = await import('rollup');
    const { nodeResolve } = await import('@rollup/plugin-node-resolve');
    const terserMod = await import('@rollup/plugin-terser');
    const terser = terserMod.default ?? terserMod;
    const bundle = await rollup({
        input: 'virtual:entry',
        plugins: [
            {
                name: 'virtual-entry',
                resolveId(id) { if (id === 'virtual:entry')
                    return id; return null; },
                load(id) { if (id === 'virtual:entry')
                    return `import "${pkg}"`; return null; },
            },
            nodeResolve({ browser: true }),
            terser(),
        ],
    });
    const { output } = await bundle.generate({ format: 'esm' });
    await bundle.close();
    const code = output[0].code;
    return zlib.gzipSync(Buffer.from(code)).length;
}
export async function measureImportSize(pkg, bundler = 'esbuild') {
    switch (bundler) {
        case 'esbuild': return measureWithEsbuild(pkg);
        case 'webpack': return measureWithWebpack(pkg);
        case 'vite': return measureWithVite(pkg);
        case 'rollup': return measureWithRollup(pkg);
        default:
            throw new Error(`Unknown bundler: ${bundler}. Supported: esbuild, webpack, vite, rollup`);
    }
}
