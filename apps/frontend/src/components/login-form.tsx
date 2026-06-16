import { Lock } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../hooks/useAuth';
import { getProviders, signIn } from '../lib/auth';

export default function LoginForm() {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [isAutoSigningIn, setIsAutoSigningIn] = useState(true);
  const navigate = useNavigate();
  const session = useAuth();
  const [searchParams] = useSearchParams();

  const target = searchParams?.get('callbackUrl') ?? '/';
  const callbackUrl = decodeURI(target);

  useEffect(() => {
    // redirect if already authenticated
    if (session.status === 'authenticated') {
      navigate(callbackUrl, { replace: true });
      return;
    }

    // check if we can sign in automatically
    getProviders()
      .then((providers) => {
        // if no api token required we can automatically sign user in
        if (providers?.credentials.name === 'No Auth') {
          return signIn('credentials', {
            redirect: false,
          }).then((response) => {
            if (!response?.error && response?.ok) {
              navigate(callbackUrl, { replace: true });
            } else {
              setIsAutoSigningIn(false);
            }
          });
        } else {
          setIsAutoSigningIn(false);
        }
      })
      .catch(() => {
        setIsAutoSigningIn(false);
      });
  }, [navigate, callbackUrl, session.status]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const result = await signIn('credentials', {
      apiToken: input,
      redirect: false,
    });

    if (result?.error) {
      setError('Invalid API key');
    } else {
      if (result?.user?.jwtToken) {
        localStorage.setItem('jwtToken', result.user.jwtToken);
      }
      navigate(callbackUrl, { replace: true });
    }
  };

  // Show spinner while session is loading or while auto-signing in
  if (session.status === 'loading' || isAutoSigningIn) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        {/* Logo/Branding */}
        <div className="text-center space-y-2">
          <Lock className="mx-auto h-12 w-12 text-primary" />
          <h1 className="font-display text-3xl font-bold tracking-tight">Welcome Back</h1>
          <p className="text-muted-foreground">Sign in with your API key to access the reports</p>
        </div>

        {/* Login Card */}
        <Card className="border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <CardDescription>Enter your API key to continue</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="Enter your API key"
                  value={input}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    if (!newValue && error) {
                      setError('');
                    }
                    setInput(newValue);
                  }}
                  className={error ? 'border-destructive' : ''}
                  autoComplete="current-password"
                />
                {error && <p className="text-sm text-destructive animate-fade-in">{error}</p>}
              </div>
            </CardContent>
            <CardFooter className="pt-4">
              <Button type="submit" className="w-full" size="lg">
                Sign In
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Footer */}
        <p className="text-center text-sm text-muted-foreground">
          Powered by{' '}
          <a
            href="https://www.cyborgtest.com/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            CyborgTests
          </a>
        </p>
      </div>
    </div>
  );
}
