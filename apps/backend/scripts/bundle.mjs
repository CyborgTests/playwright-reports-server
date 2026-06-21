import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');
const entry = resolve(backendRoot, 'src/index.ts');
const outdir = resolve(backendRoot, 'dist');
const outfile = resolve(outdir, 'index.js');

// Externals: bundling skips these and emits bare require()/import - they must
// exist in node_modules at runtime.
const external = ['better-sqlite3', '@playwright/test', 'pino-pretty', 'fsevents'];

// ESM output lacks `require`/`__dirname`/`__filename` by default. Bundled
// CommonJS deps may still call `require()`; provide a top-level shim.
const banner = `import { createRequire as __topLevelCreateRequire } from 'node:module';
import { fileURLToPath as __topLevelFileURLToPath } from 'node:url';
import { dirname as __topLevelDirname } from 'node:path';
const require = __topLevelCreateRequire(import.meta.url);
const __filename = __topLevelFileURLToPath(import.meta.url);
const __dirname = __topLevelDirname(__filename);`;

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external,
  banner: { js: banner },
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

// html-injector reads inject.js/inject.css relative to import.meta.url.
// After bundling, that URL resolves to dist/ - copy both files there.
await copyFile(
  resolve(backendRoot, 'src/lib/report-injection/inject.js'),
  resolve(outdir, 'inject.js')
);
await copyFile(
  resolve(backendRoot, 'src/lib/report-injection/inject.css'),
  resolve(outdir, 'inject.css')
);
