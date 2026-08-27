import { createHash } from 'node:crypto';

export function computeErrorSignature(message: string, filePath?: string): string {
  const normalized = message
    .replace(/\d+/g, 'N')
    .replace(/['"][^'"]*['"]/g, 'S')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);

  const input = filePath !== undefined ? `${filePath}:${normalized}` : normalized;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}
