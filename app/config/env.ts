import { cleanEnv, str, num, json } from 'envalid';

import { defaultLinks, type HeaderLinks } from './site';

export const env = cleanEnv(process.env, {
  // authorisation
  API_TOKEN: str({ desc: 'API token for authorization', default: undefined }),
  UI_AUTH_EXPIRE_HOURS: str({ desc: 'How much hours are allowed to keep auth session valid', default: '2' }),
  // white-label
  APP_TITLE: str({ desc: 'Application title', default: 'Cyborg Tests' }),
  APP_HEADER_LINKS: json<HeaderLinks>({ desc: 'Application header links', default: defaultLinks }),
  APP_LOGO_PATH: str({ desc: 'Path to the application logo', default: '/logo.svg' }),
  APP_FAVICON_PATH: str({ desc: 'Path to the application favicon', default: '/favicon.ico' }),
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
