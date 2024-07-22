import { cleanEnv, str } from 'envalid';

export const env = cleanEnv(process.env, {
  API_TOKEN: str({ desc: 'API token for authorization' }),
});
