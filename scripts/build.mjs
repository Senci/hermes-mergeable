// Canonical build of desktop/plugin.js: CI diffs the bundle, so no minify; SDK and react are host-injected.
// Usage: sh scripts/rebuild.sh (installs the pinned esbuild first), or node scripts/build.mjs with it in node_modules

import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PINNED = '0.28.2'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lookup = process.env.ESBUILD_DIR ? join(resolve(process.env.ESBUILD_DIR), 'noop.js') : join(root, 'noop.js')

let esbuild
try {
  esbuild = createRequire(lookup)('esbuild')
} catch {
  console.error(`FAIL: esbuild ${PINNED} not found; run: sh scripts/rebuild.sh`)
  process.exit(1)
}
if (esbuild.version !== PINNED) {
  console.error(`FAIL: esbuild ${esbuild.version} found, the build is pinned to ${PINNED}; run: sh scripts/rebuild.sh`)
  process.exit(1)
}

esbuild.buildSync({
  entryPoints: [join(root, 'desktop', 'src', 'index.js')],
  outfile: join(root, 'desktop', 'plugin.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  charset: 'utf8',
  legalComments: 'inline',
  logLevel: 'warning',
  // The `// desktop/src/...` banners are relative to the plugin root, not the machine's cwd.
  absWorkingDir: root,
  external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
})
console.log('built desktop/plugin.js')
