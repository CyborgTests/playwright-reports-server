#!/usr/bin/env node
/**
 * Rebuilds @playwright-reports/shared only when its sources are newer than its
 * compiled output. Both backend (tsx) and frontend (Vite) import shared from
 * its dist/, so stale sources would silently serve old code.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharedRoot = join(repoRoot, "packages", "shared");
const srcDir = join(sharedRoot, "src");
const distDir = join(sharedRoot, "dist");

function latestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // dir does not exist
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, latestMtime(full));
    } else {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

const srcMtime = latestMtime(srcDir);
const distMtime = latestMtime(distDir);

if (distMtime === 0) {
  console.log("[shared] no build found — building…");
} else if (srcMtime > distMtime) {
  console.log("[shared] sources changed since last build — rebuilding…");
} else {
  console.log("[shared] up to date — skipping build");
  process.exit(0);
}

execFileSync("pnpm", ["--filter", "@playwright-reports/shared", "build"], {
  cwd: repoRoot,
  stdio: "inherit",
});
