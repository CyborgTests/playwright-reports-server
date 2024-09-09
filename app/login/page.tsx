import LoginForm from '@/app/components/login-form';
import { env } from '@/app/config/env';

export default function LoginPage() {
  const correctApiToken = env.API_TOKEN;

  const expiryEnv = env.UI_AUTH_EXPIRE_HOURS;

  const expirationHours = !!expiryEnv ? parseInt(expiryEnv, 10) : 12;

  return <LoginForm expectedToken={correctApiToken} expirationHours={expirationHours} />;
}
