import { useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldCheck } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../hooks/useAuth';
import { useOAuthProviders } from '../hooks/useOAuth';
import { oauthStartUrl, resetPassword, setupAdmin, signIn } from '../lib/auth';

function SsoButtons({ callbackUrl }: { callbackUrl: string }) {
  const { data: providers = [] } = useOAuthProviders();
  if (providers.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/60" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>
      {providers.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant="outline"
          className="w-full"
          size="lg"
          onClick={() => {
            window.location.href = oauthStartUrl(p.id, { callbackUrl });
          }}
        >
          Continue with {p.label}
        </Button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-fade-in">{children}</div>
    </div>
  );
}

export default function LoginForm() {
  const navigate = useNavigate();
  const session = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const callbackUrl = decodeURI(searchParams?.get('callbackUrl') ?? '/');
  const resetToken = searchParams?.get('reset') ?? '';

  useEffect(() => {
    if (!resetToken && session.status === 'authenticated') navigate(callbackUrl, { replace: true });
  }, [session.status, callbackUrl, navigate, resetToken]);

  const afterAuth = async () => {
    await queryClient.invalidateQueries({ queryKey: ['auth-session'] });
    navigate(callbackUrl, { replace: true });
  };

  if (session.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (resetToken) return <ResetCard token={resetToken} />;
  return session.needsSetup ? <SetupCard onDone={afterAuth} /> : <LoginCard onDone={afterAuth} />;
}

function ResetCard({ token }: { token: string }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    const result = await resetPassword(token, password);
    if (result.ok) {
      setDone(true);
    } else {
      setError(result.error ?? 'Invalid or expired reset link');
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <div className="text-center space-y-2">
        <Lock className="mx-auto h-12 w-12 text-primary" />
        <h1 className="font-display text-3xl font-bold tracking-tight">Set a new password</h1>
      </div>
      <Card className="border-border/50 shadow-lg">
        <CardHeader className="space-y-1 pb-4">
          <CardDescription>
            {done
              ? 'Password updated. You can sign in now.'
              : 'Choose a new password for your account'}
          </CardDescription>
        </CardHeader>
        {done ? (
          <CardFooter className="pt-4">
            <Button
              className="w-full"
              size="lg"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </Button>
          </CardFooter>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-password">New password</Label>
                <Input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className={error ? 'border-destructive' : ''}
                />
                {error && <p className="text-sm text-destructive animate-fade-in">{error}</p>}
              </div>
            </CardContent>
            <CardFooter className="pt-4">
              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting && <Spinner className="mr-2 h-4 w-4" />}
                {submitting ? 'Updating…' : 'Update password'}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </Shell>
  );
}

function LoginCard({ onDone }: { onDone: () => Promise<void> }) {
  const [searchParams] = useSearchParams();
  const callbackUrl = searchParams?.get('callbackUrl') ?? '/';
  const ssoError = searchParams?.get('error');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    const result = await signIn(username, password);
    if (result.ok) {
      await onDone();
    } else {
      setError(result.error ?? 'Invalid username or password');
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <div className="text-center space-y-2">
        <Lock className="mx-auto h-12 w-12 text-primary" />
        <h1 className="font-display text-3xl font-bold tracking-tight">Welcome Back</h1>
        <p className="text-muted-foreground">Sign in to access the reports</p>
      </div>
      <Card className="border-border/50 shadow-lg">
        <CardHeader className="space-y-1 pb-4">
          <CardDescription>Enter your username and password</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {ssoError && (
              <p className="text-sm text-destructive animate-fade-in">
                Single sign-on failed. Try again, or sign in with your username and password.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={error ? 'border-destructive' : ''}
              />
              {error && <p className="text-sm text-destructive animate-fade-in">{error}</p>}
            </div>
          </CardContent>
          <CardFooter className="pt-4">
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting && <Spinner className="mr-2 h-4 w-4" />}
              {submitting ? 'Signing in…' : 'Sign In'}
            </Button>
          </CardFooter>
        </form>
        <CardContent className="pt-0">
          <SsoButtons callbackUrl={callbackUrl} />
        </CardContent>
      </Card>
    </Shell>
  );
}

function SetupCard({ onDone }: { onDone: () => Promise<void> }) {
  const [apiToken, setApiToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    const created = await setupAdmin(apiToken, username, password);
    if (!created.ok) {
      setError(created.error ?? 'Setup failed');
      setSubmitting(false);
      return;
    }
    // Setup creates the admin but no session; sign in to establish one.
    const signedIn = await signIn(username, password);
    if (signedIn.ok) {
      await onDone();
    } else {
      setError('Admin created. Please sign in.');
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <div className="text-center space-y-2">
        <ShieldCheck className="mx-auto h-12 w-12 text-primary" />
        <h1 className="font-display text-3xl font-bold tracking-tight">Create admin account</h1>
        <p className="text-muted-foreground">
          First-time setup - provide the server API token and choose admin credentials.
        </p>
      </div>
      <Card className="border-border/50 shadow-lg">
        <CardHeader className="space-y-1 pb-4">
          <CardDescription>This is only available until the first admin exists.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-token">Server API token</Label>
              <Input
                id="api-token"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="API_TOKEN"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-username">Admin username</Label>
              <Input
                id="setup-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-password">Admin password</Label>
              <Input
                id="setup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={error ? 'border-destructive' : ''}
              />
              {error && <p className="text-sm text-destructive animate-fade-in">{error}</p>}
            </div>
          </CardContent>
          <CardFooter className="pt-4">
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting && <Spinner className="mr-2 h-4 w-4" />}
              {submitting ? 'Creating…' : 'Create admin'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </Shell>
  );
}
