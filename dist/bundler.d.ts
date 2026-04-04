export type BundlerName = 'esbuild' | 'webpack' | 'vite' | 'rollup';
export declare function measureImportSize(pkg: string, bundler?: BundlerName): Promise<number>;
