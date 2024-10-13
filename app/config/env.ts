import { cleanEnv, str, num } from 'envalid';

export const env = cleanEnv(process.env, {
  // authorisation
  API_TOKEN: str({ desc: 'API token for authorization', default: undefined }),
  UI_AUTH_EXPIRE_HOURS: str({ desc: 'How much hours are allowed to keep auth session valid', default: '2' }),
  // storage
  DATA_STORAGE: str({ desc: 'Where to store data', default: 'fs' }),
  S3_ENDPOINT: str({ desc: 'S3 endpoint', default: undefined }),
  S3_ACCESS_KEY: str({ desc: 'S3 access key', default: undefined }),
  S3_SECRET_KEY: str({ desc: 'S3 secret key', default: undefined }),
  S3_PORT: num({ desc: 'S3 port', default: undefined }),
  S3_REGION: str({ desc: 'S3 region', default: undefined }),
  S3_BUCKET: str({ desc: 'S3 bucket', default: 'playwright-reports-server' }),
  S3_BATCH_SIZE: num({ desc: 'S3 batch size', default: 10 }),
});
