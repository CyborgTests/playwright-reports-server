import JSZip from 'jszip';

import { withError } from '@/app/lib/withError';

export const isBufferZipResult = async (buffer: Buffer) => {
  const { result: zip, error } = await withError(JSZip.loadAsync(buffer));

  if (error) {
    throw Error(`failed to load zip file: ${error.message}`);
  }

  if (!zip) {
    throw Error('parsed report data is empty');
  }

  const resourcesFolder = zip.folder('resources');

  if (!resourcesFolder) {
    throw Error('no resources found in the zip');
  }

  const file = zip.file('report.jsonl');

  if (!file) {
    throw Error('no report.jsonl file found in the zip');
  }
};
