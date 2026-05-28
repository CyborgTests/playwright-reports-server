'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardBody, CardFooter, CardHeader, Input, Spinner } from '@heroui/react';
import { getProviders, signIn, useSession } from 'next-auth/react';

import { title } from '@/app/components/primitives';

type ProvidersMap = Awaited<ReturnType<typeof getProviders>>;

export default function LoginForm() {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [isAutoSigningIn, setIsAutoSigningIn] = useState(true);
  const [providers, setProviders] = useState<ProvidersMap | null>(null);
  const router = useRouter();
  const session = useSession();
  const searchParams = useSearchParams();

  const target = searchParams?.get('callbackUrl') ?? '/';
  const callbackUrl = decodeURI(target);
  const errorParam = searchParams?.get('error');
  const isAccessDenied = errorParam === 'AccessDenied';

  useEffect(() => {
    // redirect if already authenticated
    if (session.status === 'authenticated') {
      router.replace(callbackUrl);

      return;
    }

    // check if we can sign in automatically
    getProviders()
      .then((available) => {
        setProviders(available);
        // if no api token required we can automatically sign user in
        if (available?.credentials?.name === 'No Auth') {
          return signIn('credentials', {
            redirect: false,
          }).then((response) => {
            if (!response?.error && response?.ok) {
              router.replace(callbackUrl);
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
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const result = await signIn('credentials', {
      apiToken: input,
      redirect: false,
    });

    result?.error ? setError('invalid API key') : router.replace(callbackUrl);
  };

  // Show spinner while session is loading or while auto-signing in
  if (session.status === 'loading' || isAutoSigningIn) {
    return <Spinner className="w-full" />;
  }

  if (providers?.google) {
    return (
      <div className="grid col-span-6 justify-center">
        <h1 className={title()}>Login</h1>
        <Card className="h-screen min-w-[340px] max-h-[250px] p-2 mt-10">
          <CardHeader className="content-start max-h-14">
            <p className="text-md">Sign in with your company Google account</p>
          </CardHeader>
          <CardBody className="min-w-full h-24">
            {isAccessDenied && (
              <p className="text-danger text-sm">Your email domain is not allowed to access this server.</p>
            )}
          </CardBody>
          <CardFooter className="mt-5">
            <Button className="w-full" color="primary" onPress={() => signIn('google', { callbackUrl })}>
              Sign in with Google
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid col-span-6 justify-center">
      <h1 className={title()}>Login</h1>
      <Card className="h-screen min-w-[340px] max-h-[250px] p-2 mt-10">
        <CardHeader className="content-start max-h-14">
          <p className="text-md">Please provide API key to sign in</p>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardBody className="min-w-full h-24">
            <Input
              fullWidth
              isRequired
              errorMessage={error}
              isInvalid={!!error}
              placeholder="Enter API Key"
              type="password"
              value={input}
              onChange={(e) => {
                const newValue = e.target.value;

                if (!newValue && error) {
                  setError('');
                }
                setInput(newValue);
              }}
            />
          </CardBody>
          <CardFooter className="mt-5">
            <Button className="w-full" color="primary" type="submit">
              Login
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
