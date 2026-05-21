import { CliHttpError } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';

const TEXT_CONTENT_TYPES = /^(text\/|application\/(json|xml|.*\+(json|xml))|.+\+text)/i;

/**
 * Fetch an attachment (or any server-relative URL) with Bearer auth.
 * Emits `{ url, status, contentType, bytes, encoding, content }` so the agent
 * doesn't have to assemble the URL + auth header itself when grabbing a
 * screenshot or error-context markdown listed in a `test brief`.
 *
 * Server-relative paths (`/api/serve/...`) are resolved against the configured
 * server. Absolute URLs are used as-is.
 */
export async function runAttachment(input: string): Promise<void> {
  if (!input) {
    throw new Error('Usage: pwrs-cli attachment <url|/api/serve/...>');
  }
  const config = resolveConfig();
  const url =
    input.startsWith('http://') || input.startsWith('https://')
      ? input
      : new URL(input.startsWith('/') ? input : `/${input}`, config.server).toString();

  const headers: Record<string, string> = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(url, { headers });
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

  if (!response.ok) {
    const text = await response.text();
    throw new CliHttpError(response.status, text, url);
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
