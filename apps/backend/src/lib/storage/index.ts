export type { Storage } from './types.js';
export * from './types.js';

import { env } from '../../config/env.js';
import { AzureBlob } from './azure.js';
import { FS } from './fs.js';
import { S3 } from './s3.js';
import type { Storage } from './types.js';

const pickStorage = (): Storage => {
  switch (env.DATA_STORAGE) {
    case 's3':
      return S3.getInstance();
    case 'azure':
      return AzureBlob.getInstance();
    default:
      return FS;
  }
};

export const storage: Storage = pickStorage();
