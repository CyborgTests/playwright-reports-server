export type { Storage } from './types.js';
export * from './types.js';

import { env } from '../../config/env.js';
import type { Storage } from './types.js';

// Dynamically import only the selected backend so the unused storage SDK
// (@aws-sdk/* or @azure/storage-blob) never runs its module-init code.
export let storage: Storage;

export const initStorage = async (): Promise<Storage> => {
  switch (env.DATA_STORAGE) {
    case 's3':
      storage = (await import('./s3.js')).S3.getInstance();
      break;
    case 'azure':
      storage = (await import('./azure.js')).AzureBlob.getInstance();
      break;
    default:
      storage = (await import('./fs.js')).FS;
      break;
  }
  return storage;
};
