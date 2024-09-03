import LoginForm from '@/app/components/login-form';
import { env } from '@/app/config/env';

export default function LoginPage() {
  const correctApiToken = env.API_TOKEN;

  return <LoginForm expectedToken={correctApiToken} />;
}
