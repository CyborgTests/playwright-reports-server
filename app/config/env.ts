import { cleanEnv, str, num, bool } from 'envalid';

export const env = cleanEnv(process.env, {
  API_TOKEN: str({ desc: 'API token for authorization', default: undefined }),
  UI_AUTH_EXPIRE_HOURS: str({ desc: 'How much hours are allowed to keep auth session valid', default: '2' }),
  AUTH_SECRET: str({ desc: 'Secret for JWT', default: undefined }),
  DATA_STORAGE: str({ desc: 'Where to store data', default: 'fs' }),
  USE_SERVER_CACHE: bool({ desc: 'Use server side indexed cache for backend queries', default: false }),
  S3_ENDPOINT: str({ desc: 'S3 endpoint', default: undefined }),
  S3_ACCESS_KEY: str({ desc: 'S3 access key', default: undefined }),
  S3_SECRET_KEY: str({ desc: 'S3 secret key', default: undefined }),
  S3_PORT: num({ desc: 'S3 port', default: undefined }),
  S3_REGION: str({ desc: 'S3 region', default: undefined }),
  S3_BUCKET: str({ desc: 'S3 bucket', default: 'playwright-reports-server' }),
  S3_BATCH_SIZE: num({ desc: 'S3 batch size', default: 10 }),
  RESULT_EXPIRE_DAYS: num({ desc: 'How much days to keep results', default: undefined }),
  RESULT_EXPIRE_CRON_SCHEDULE: str({ desc: 'Cron schedule for results cleanup', default: '33 3 * * *' }),
  REPORT_EXPIRE_DAYS: num({ desc: 'How much days to keep reports', default: undefined }),
  REPORT_EXPIRE_CRON_SCHEDULE: str({ desc: 'Cron schedule for reports cleanup', default: '44 4 * * *' }),
});
