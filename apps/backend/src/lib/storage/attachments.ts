import path from 'node:path';
import type { AttachmentCleanupKind } from '@playwright-reports/shared';
import { processWithConcurrency } from '../utils/semaphore.js';
import { withError } from '../withError.js';
import { reportPrefix } from './constants.js';
import type { AttachmentDeleteResult, AttachmentSizes, StorageEntry } from './types.js';

const KIND_BY_EXTENSION: Record<string, AttachmentCleanupKind> = {
  '.zip': 'trace',
  '.md': 'trace',
  '.webm': 'video',
  '.png': 'screenshot',
};

export function attachmentKindOf(key: string): AttachmentCleanupKind | null {
  return KIND_BY_EXTENSION[path.posix.extname(key).toLowerCase()] ?? null;
}

export async function collectAttachments(
  listEntries: (prefix: string) => Promise<StorageEntry[]>,
  reportId: string,
  storagePath: string | null,
  kinds: AttachmentCleanupKind[]
): Promise<{ entries: StorageEntry[]; traceDirectory: string | null }> {
  const prefix = reportPrefix(reportId, storagePath);
  const entries = (await listEntries(`${prefix}/data`)).filter((entry) => {
    const kind = attachmentKindOf(entry.key);
    return kind !== null && kinds.includes(kind);
  });

  if (!kinds.includes('trace')) return { entries, traceDirectory: null };

  const traceDirectory = `${prefix}/trace`;
  entries.push(...(await listEntries(traceDirectory)));
  return { entries, traceDirectory };
}

export async function summarizeAttachments(
  listEntries: (prefix: string) => Promise<StorageEntry[]>,
  reportId: string,
  storagePath: string | null
): Promise<AttachmentSizes> {
  const { entries, traceDirectory } = await collectAttachments(listEntries, reportId, storagePath, [
    'trace',
    'video',
    'screenshot',
  ]);

  const sizes: AttachmentSizes = {};
  for (const entry of entries) {
    const kind =
      traceDirectory && entry.key.startsWith(`${traceDirectory}/`)
        ? 'trace'
        : attachmentKindOf(entry.key);
    if (!kind) continue;

    const bucket = sizes[kind] ?? { bytes: 0, count: 0 };
    bucket.bytes += entry.size;
    if (kind !== 'trace' || entry.key.endsWith('.zip')) bucket.count += 1;
    sizes[kind] = bucket;
  }

  return sizes;
}

export async function deleteEntries(
  entries: StorageEntry[],
  concurrency: number,
  label: string,
  remove: (key: string) => Promise<unknown>
): Promise<AttachmentDeleteResult> {
  const outcomes = await processWithConcurrency(entries, concurrency, async (entry) => {
    const { error } = await withError(remove(entry.key));
    if (error) {
      console.warn(`[${label}] failed to delete attachment ${entry.key}: ${error.message}`);
      return null;
    }
    return entry.size;
  });

  return {
    freed: outcomes.reduce<number>((total, size) => total + (size ?? 0), 0),
    failed: outcomes.filter((size) => size === null).length,
  };
}
