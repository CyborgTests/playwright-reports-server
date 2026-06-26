const BASE64_PREFIX = 'data:application/zip;base64,';
const BASE64_RE = new RegExp(`${BASE64_PREFIX}([^";\\s]+)(?=[";\\s]|$)`);

export function decodeReportZip(html: string): Buffer | null {
  const base64 = BASE64_RE.exec(html)?.[1]?.trim();
  if (!base64) return null;
  return Buffer.from(base64, 'base64');
}
