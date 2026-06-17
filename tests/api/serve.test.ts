import { expect } from '@playwright/test';
import { test } from './fixtures/base';

// Exercises the Range/streaming behaviour of /api/serve/[[...filePath]] against a
// real generated report. The `generatedReport` fixture uploads correct_blob.zip and
// generates a Smoke report whose `reportUrl` points at the served index.html.
test.describe.serial('GET /api/serve range support', () => {
  test('serves full file, partial ranges, suffix ranges and falls back on a bad range', async ({
    request,
    generatedReport,
  }) => {
    const serveUrl = generatedReport.body.reportUrl;
    expect(serveUrl).toContain('/api/serve/');

    // Full file — advertises range support; capture the total size from the body.
    const full = await request.get(serveUrl);
    expect(full.status()).toBe(200);
    expect(full.headers()['accept-ranges']).toBe('bytes');
    const size = (await full.body()).length;
    expect(size).toBeGreaterThan(11);

    // Closed range "bytes=0-10" → 206 with the first 11 bytes.
    const closed = await request.get(serveUrl, { headers: { Range: 'bytes=0-10' } });
    expect(closed.status()).toBe(206);
    expect(closed.headers()['content-range']).toBe(`bytes 0-10/${size}`);
    expect(closed.headers()['content-length']).toBe('11');
    expect((await closed.body()).length).toBe(11);

    // Suffix range "bytes=-5" → last 5 bytes.
    const suffix = await request.get(serveUrl, { headers: { Range: 'bytes=-5' } });
    expect(suffix.status()).toBe(206);
    expect(suffix.headers()['content-range']).toBe(`bytes ${size - 5}-${size - 1}/${size}`);
    expect((await suffix.body()).length).toBe(5);

    // Open-ended range "bytes=X-" → from X to the last byte.
    const open = await request.get(serveUrl, { headers: { Range: `bytes=${size - 3}-` } });
    expect(open.status()).toBe(206);
    expect(open.headers()['content-range']).toBe(`bytes ${size - 3}-${size - 1}/${size}`);
    expect((await open.body()).length).toBe(3);

    // A start past EOF → 416 Range Not Satisfiable with an unbounded Content-Range.
    const oob = await request.get(serveUrl, { headers: { Range: `bytes=${size}-${size + 10}` } });
    expect(oob.status()).toBe(416);
    expect(oob.headers()['content-range']).toBe(`bytes */${size}`);

    // Malformed range header → falls through to the buffered 200 response.
    const malformed = await request.get(serveUrl, { headers: { Range: 'bytes=abc' } });
    expect(malformed.status()).toBe(200);
    expect(malformed.headers()['content-range']).toBeUndefined();
  });
});
