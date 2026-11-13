import { build } from 'esbuild'

await Promise.all([
  build({
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    target: 'node22',
  }),
  build({
    entryPoints: ['src/client.tsx'],
    outfile: 'lib/client.cjs',
    bundle: true,
    external: ['react', 'react/jsx-runtime'],
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'text', '.png': 'dataurl' },
    banner: { js: 'window.__ModuleLoader__.load({id:"roundtable-bots",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
    footer: { js: 'return module.exports;}});' },
  }),
])
