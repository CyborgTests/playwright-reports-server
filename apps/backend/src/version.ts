import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// This module must stay directly under src/. The relative path has to land on
// apps/backend/package.json in all three run modes, and only this depth does:
// tsx on src/version.ts, tsc output at dist/version.js, and the esbuild bundle,
// which collapses every module's import.meta.url onto dist/index.js.
const readVersion = (): string => {
  try {
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

export const APP_VERSION = readVersion();
