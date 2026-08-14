import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Azure's env is validated at import time; provide the minimum a client needs.
// The key only has to be valid base64 - SAS signing is a local HMAC, so these
// fake credentials let us exercise commitPrefix without any network or emulator.
process.env.DATA_STORAGE = 'azure';
process.env.AZURE_ACCOUNT_NAME ??= 'devstoreaccount1';
process.env.AZURE_ACCOUNT_KEY ??= Buffer.from('unit-test-key').toString('base64');
process.env.AZURE_CONTAINER ??= 'test-container';

describe('AzureBlob.commitPrefix', () => {
  it('copies each blob from the tmp prefix to the final prefix using a signed read SAS source', async () => {
    const { AzureBlob } = await import('./azure.js');

    // biome-ignore lint/suspicious/noExplicitAny: reach into private members to stub the network.
    const azure = AzureBlob.getInstance() as any;
    const container = azure.container;

    const srcPrefix = 'reports/report-1.tmp';
    const dstPrefix = 'reports/report-1';
    const tmpBlobs = [`${srcPrefix}/index.html`, `${srcPrefix}/data/report.json`];

    // Serve the tmp blobs from listBlobsFlat; every other prefix (e.g. the
    // clearPrefix sweep of the destination) lists nothing.
    container.listBlobsFlat = ({ prefix }: { prefix: string }) =>
      (async function* () {
        if (prefix.startsWith(srcPrefix)) {
          for (const name of tmpBlobs) yield { name };
        }
      })();

    // Wrap the real getBlobClient so generateSasUrl still runs for real, but the
    // network calls (copy + delete) are captured instead of hitting Azure.
    const copies: { dst: string; src: string }[] = [];
    const realGetBlobClient = container.getBlobClient.bind(container);
    container.getBlobClient = (key: string) => {
      const client = realGetBlobClient(key);
      client.syncCopyFromURL = async (url: string) => {
        copies.push({ dst: key, src: url });
        return {};
      };
      client.deleteIfExists = async () => ({});
      return client;
    };

    await azure.commitPrefix(srcPrefix, dstPrefix);

    // One copy per tmp blob, remapped from the tmp prefix to the final prefix.
    assert.deepEqual(copies.map((c) => c.dst).sort(), [
      'reports/report-1/data/report.json',
      'reports/report-1/index.html',
    ]);

    // Regression guard: the copy *source* must be a signed read SAS URL, not the
    // bare blob URL. Azure authenticates the copy source independently of the
    // request's shared-key signature, so a bare URL fails against a private
    // container. A bare URL carries no `sig`; the fix adds one.
    for (const { src } of copies) {
      const url = new URL(src);
      assert.ok(url.searchParams.has('sig'), `copy source is not SAS-signed: ${src}`);
      assert.ok(url.searchParams.has('se'), 'SAS is missing an expiry');
      assert.equal(url.searchParams.get('sp'), 'r', 'SAS must grant read-only access');
    }
  });
});
