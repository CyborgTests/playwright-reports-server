import { CliHttpError } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';

const TEXT_CONTENT_TYPES = /^(text\/|application\/(json|xml|.*\+(json|xml))|.+\+text)/i;

interface AttachmentOpts {
  inline?: boolean;
}

/**
 * Fetch an attachment (or any server-relative URL) with Bearer auth.
 *
 * Default emits `{ url, status, contentType, bytes }` 
 * Server-relative paths (`/api/serve/...`) are resolved against the configured
 * server. Absolute URLs are used as-is.
 */
export async function runAttachment(input: string, opts: AttachmentOpts = {}): Promise<void> {
  if (!input) {
    throw new Error('Usage: pwrs-cli attachment <url|/api/serve/...> [--inline]');
  }
  const config = resolveConfig();
  const url =
    input.startsWith('http://') || input.startsWith('https://')
      ? input
      : new URL(input.startsWith('/') ? input : `/${input}`, config.server).toString();

  const headers: Record<string, string> = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const method = opts.inline ? 'GET' : 'HEAD';
  const response = await fetch(url, { headers, method });
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

  if (!response.ok) {
    const errText = opts.inline
      ? await response.text()
      : await fetch(url, { headers })
          .then((r) => r.text())
          .catch(() => '');
    throw new CliHttpError(response.status, errText, url);
  }

  if (!opts.inline) {
    const contentLength = response.headers.get('content-length');
    const bytes = contentLength ? Number.parseInt(contentLength, 10) : undefined;
    emitJson({
      url,
      status: response.status,
      contentType,
      bytes: Number.isFinite(bytes) ? bytes : undefined,
    });
    return;
  }

  const isText = TEXT_CONTENT_TYPES.test(contentType);
  if (isText) {
    const content = await response.text();
    emitJson({
      url,
      status: response.status,
      contentType,
      bytes: Buffer.byteLength(content, 'utf8'),
      encoding: 'utf8',
      content,
    });
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  emitJson({
    url,
    status: response.status,
    contentType,
    bytes: buffer.byteLength,
    encoding: 'base64',
    content: buffer.toString('base64'),
  });
}
