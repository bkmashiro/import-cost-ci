import esbuild from 'esbuild';
import zlib from 'zlib';
export async function measureImportSize(pkg) {
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
