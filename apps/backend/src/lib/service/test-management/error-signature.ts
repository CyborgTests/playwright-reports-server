export function computeErrorSignature(message: string, filePath?: string): string {
  const normalized = message
    .replace(/\d+/g, 'N')
    .replace(/['"][^'"]*['"]/g, 'S')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);

  let hash = 0;
  const input = filePath !== undefined ? `${filePath}:${normalized}` : normalized;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}
