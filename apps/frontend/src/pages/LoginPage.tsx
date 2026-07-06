import { Suspense } from 'react';
import LoginForm from '@/components/login-form';
import { Spinner } from '@/components/ui/spinner';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
