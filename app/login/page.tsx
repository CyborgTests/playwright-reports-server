import LoginForm from '@/app/components/login-form';

export default function LoginPage() {
  const correctApiToken = process.env.API_TOKEN;

  return <LoginForm expectedToken={correctApiToken} />;
}
