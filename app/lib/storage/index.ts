export * from './types';
import { FS } from './fs';
import { S3 } from './s3';

import { env } from '@/app/config/env';

export const storage = env.DATA_STORAGE === 's3' ? S3.getInstance() : FS;
