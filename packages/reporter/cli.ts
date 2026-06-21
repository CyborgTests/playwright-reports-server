#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import { ReportServerClient } from './client.js';

type ParsedArgs = {
  command: string;
  positional: string[];
  flags: Record<string, string>;
  repeated: Record<string, string[]>;
};

const REPEATABLE = new Set(['meta']);

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Flag --${name} requires a value`);
      }
      if (REPEATABLE.has(name)) {
        const existing = repeated[name] ?? [];
        existing.push(next);
        repeated[name] = existing;
      } else {
        flags[name] = next;
      }
      i++;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags, repeated };
}

function buildMetadata(
  flags: Record<string, string>,
  metaPairs: string[]
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (flags.project) metadata.project = flags.project;
  if (flags.title) metadata.title = flags.title;
  if (flags.tags) {
    metadata.tags = flags.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  for (const pair of metaPairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
      throw new Error(`--meta value must be key=value, got: ${pair}`);
    }
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1);
    if (!key) throw new Error(`--meta key cannot be empty in: ${pair}`);
    metadata[key] = value;
  }
  return metadata;
}

async function zipDirectory(sourceDir: string, outputPath: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') console.warn('[zip] warning:', err.message);
      else reject(err);
    });
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function printHelp(): void {
  console.log(`playwright-reporter-cli - upload a pre-built Playwright HTML report

Usage:
  playwright-reporter-cli upload <reportDir> --url <serverUrl> [options]

Options:
  --url <serverUrl>        Reports server URL (required)
  --token <token>          Auth token (if server requires it)
  --project <name>         Project name metadata
  --title <title>          Report title metadata
  --tags a,b,c             Comma-separated tags
  --meta key=value         Custom metadata field (repeatable)

Example:
  playwright-reporter-cli upload ./playwright-report \\
    --url https://reports.example.com \\
    --token "$REPORTS_TOKEN" \\
    --project web --tags ci,nightly \\
    --meta branch=main --meta build=12345
`);
}

async function runUpload(parsed: ParsedArgs): Promise<void> {
  const [reportDir] = parsed.positional;
  if (!reportDir) throw new Error('Missing <reportDir> argument');
  if (!parsed.flags.url) throw new Error('Missing required --url flag');

  const resolvedDir = path.resolve(reportDir);
  const dirStat = await fsp.stat(resolvedDir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new Error(`Report directory not found: ${resolvedDir}`);
  }

  const indexStat = await fsp.stat(path.join(resolvedDir, 'index.html')).catch(() => null);
  if (!indexStat?.isFile()) {
    throw new Error(`index.html not found at root of ${resolvedDir}`);
  }

  const metadata = buildMetadata(parsed.flags, parsed.repeated.meta ?? []);
  const tmpZip = path.join(os.tmpdir(), `playwright-report-upload-${randomUUID()}.zip`);

  try {
    console.log(`Zipping ${resolvedDir} -> ${tmpZip}`);
    const bytes = await zipDirectory(resolvedDir, tmpZip);
    console.log(`Zipped ${(bytes / 1024 / 1024).toFixed(1)} MB`);

    const client = new ReportServerClient({ url: parsed.flags.url, token: parsed.flags.token });
    const result = await client.uploadReportZip(tmpZip, metadata, { logProgress: true });

    console.log(`Report uploaded: ${result.reportUrl}`);
    console.log(`Report ID: ${result.reportId}`);
  } finally {
    await fsp.unlink(tmpZip).catch(() => {
      // ignore: temp file may already be gone if zip failed
    });
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.command || parsed.command === '--help' || parsed.command === '-h') {
    printHelp();
    return;
  }

  switch (parsed.command) {
    case 'upload':
      await runUpload(parsed);
      return;
    default:
      console.error(`Unknown command: ${parsed.command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
