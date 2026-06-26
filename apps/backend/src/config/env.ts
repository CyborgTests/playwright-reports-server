import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_TYPES } from '@playwright-reports/shared';
import { config } from 'dotenv';
import { bool, cleanEnv, num, str } from 'envalid';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const envPaths = [
  join(__dirname, '../../../../.env'), //backend dist folder
  join(process.cwd(), '.env'), // working directory
  '/app/.env', // app root in Docker
];

for (const envPath of envPaths) {
  try {
    config({ path: envPath });
    break;
  } catch {
    // Continue to next path if this one doesn't exist
  }
}

export const env = cleanEnv(process.env, {
  PORT: num({ desc: 'Port to run the server on', default: 3001 }),
  HOST: str({ desc: 'Host to run the server on', default: '0.0.0.0' }),
  API_BASE_PATH: str({ desc: 'Base path for the API', default: '' }),
  API_TOKEN: str({ desc: 'API token for authorization', default: undefined }),
  UI_AUTH_EXPIRE_HOURS: str({
    desc: 'Idle session lifetime in hours (sliding; bounded by a 30-day absolute cap)',
    default: '12',
  }),
  AUTH_SECRET: str({
    desc: 'Encryption key for stored secrets. Set a stable value in production.',
    default: undefined,
  }),
  COOKIE_SECURE: bool({
    desc: 'Set the Secure flag on auth cookies. Default true; set false only for LAN/HTTP deployments.',
    default: true,
  }),
  ROOT_USERNAME: str({
    desc: 'Emergency admin username (recovery only). Enables root login when set with ROOT_PASSWORD.',
    default: undefined,
  }),
  ROOT_PASSWORD: str({
    desc: 'Emergency admin password (recovery only).',
    default: undefined,
  }),
  DATA_STORAGE: str({
    desc: 'Where to store data',
    default: 'fs',
    choices: Object.values(STORAGE_TYPES),
  }),
  // s3
  S3_ENDPOINT: str({ desc: 'S3 endpoint', default: undefined }),
  S3_ACCESS_KEY: str({ desc: 'S3 access key', default: undefined }),
  S3_SECRET_KEY: str({ desc: 'S3 secret key', default: undefined }),
  S3_PORT: num({ desc: 'S3 port', default: undefined }),
  S3_REGION: str({ desc: 'S3 region', default: undefined }),
  S3_USE_SSL: bool({
    desc: 'Whether to use HTTPS when talking to the S3 endpoint. Set to false for local MinIO over plain HTTP.',
    default: true,
  }),
  S3_BUCKET: str({ desc: 'S3 bucket', default: 'playwright-reports-server' }),
  S3_BATCH_SIZE: num({ desc: 'S3 batch size', default: 10 }),
  S3_MULTIPART_CHUNK_SIZE_MB: num({
    desc: 'S3 multipart upload chunk size in MB',
    default: 25,
  }),
  // azure blob storage
  AZURE_ACCOUNT_NAME: str({ desc: 'Azure Storage account name', default: undefined }),
  AZURE_ACCOUNT_KEY: str({ desc: 'Azure Storage account key', default: undefined }),
  AZURE_CONTAINER: str({
    desc: 'Azure Storage container name',
    default: 'playwright-reports-server',
  }),
  AZURE_BATCH_SIZE: num({ desc: 'Azure batch size', default: 10 }),
});
