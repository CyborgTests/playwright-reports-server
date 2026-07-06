export function firstLine(message: string): string {
  const trimmed = message.trim();
  const newlineIdx = trimmed.search(/\r?\n/);
  return newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
}

// Links a failure group to its cluster by normalized first-line shape.
export function normalizeMessageSignature(message: string | undefined): string {
  return firstLine(message ?? '')
    .replace(/0x[0-9a-fA-F]+/g, 'H')
    .replace(/['"][^'"]*['"]/g, 'S')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
