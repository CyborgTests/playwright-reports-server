import { cleanEnv, str } from 'envalid';

export const env = cleanEnv(process.env, {
  API_TOKEN: str({ desc: 'API token for authorization', default: undefined }),
  UI_AUTH_EXPIRE_HOURS: str({ desc: 'How much hours are allowed to keep auth session valid', default: '12' }),
});
