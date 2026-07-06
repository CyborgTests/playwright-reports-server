import { useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { registerWithInvite, signIn } from '@/lib/auth';

export default function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [inviteCode, setInviteCode] = useState(searchParams.get('invite') ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    const registered = await registerWithInvite(inviteCode, username, password);
    if (!registered.ok) {
      setError(registered.error ?? 'Registration failed');
      setSubmitting(false);
      return;
    }
    const signedIn = await signIn(username, password);
    if (signedIn.ok) {
      await queryClient.invalidateQueries({ queryKey: ['auth-session'] });
      navigate('/', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center space-y-2">
          <UserPlus className="mx-auto h-12 w-12 text-primary" />
          <h1 className="font-display text-3xl font-bold tracking-tight">Create your account</h1>
          <p className="text-muted-foreground">Register with an invite link</p>
        </div>
        <Card className="border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <CardDescription>Choose a username and password</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite">Invite code</Label>
                <Input
                  id="invite"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-username">Username</Label>
                <Input
                  id="reg-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
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
                {submitting ? 'Creating…' : 'Create account'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
