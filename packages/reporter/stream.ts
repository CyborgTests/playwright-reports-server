import fs from 'node:fs';

export function makeBoundary() {
  return `----pwreporter-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function fieldPart(boundary: string, name: string, value: string): Buffer {
  const head =
    `--${boundary}\r\n` + `Content-Disposition: form-data; name="${name}"\r\n\r\n` + `${value}\r\n`;
  return Buffer.from(head, 'utf8');
}

function fileHead(
  boundary: string,
  fieldName: string,
  filename: string,
  contentType: string
): Buffer {
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  return Buffer.from(head, 'utf8');
}

function closingBoundary(boundary: string): Buffer {
  return Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
}

export async function* multipartStream(opts: {
  boundary: string;
  fields: Record<string, string>;
  filePath: string;
  fileName: string;
  fileType: string;
  totalBytes: number;
  logProgress: boolean;
}): AsyncIterable<Uint8Array> {
  const { boundary, fields, filePath, fileName, fileType, totalBytes, logProgress } = opts;

  for (const [k, v] of Object.entries(fields)) {
    yield fieldPart(boundary, k, v) as Uint8Array;
  }

  yield fileHead(boundary, 'file', fileName, fileType) as Uint8Array;

  const rs = fs.createReadStream(filePath, { highWaterMark: 512 * 1024 });
  let sent = 0,
    lastPct = -5,
    lastTick = Date.now();

  for await (const chunk of rs) {
    if (logProgress && totalBytes > 0) {
      sent += (chunk as Buffer).length;
      const now = Date.now();
      const pct = Math.min(100, Math.floor((sent / totalBytes) * 100));
      if (now - lastTick >= 500 && pct >= lastPct + 2) {
        const line = `Upload: ${pct}% (${(sent / 1024 / 1024).toFixed(1)}/${(totalBytes / 1024 / 1024).toFixed(1)} MB)`;
        if (process.stdout.isTTY) process.stdout.write(`\r${line}   `);
        else console.log(line);
        lastPct = pct;
        lastTick = now;
      }
    }
    yield chunk as Uint8Array;
  }

  if (logProgress && totalBytes > 0) {
    const line = `Upload: 100% (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`;
    if (process.stdout.isTTY) process.stdout.write(`\r${line}\n`);
    else console.log(line);
  }

  yield closingBoundary(boundary) as Uint8Array;
}
