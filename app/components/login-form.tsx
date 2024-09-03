'use client';

import { type FormEvent, useLayoutEffect, useState } from 'react';
import { redirect } from 'next/navigation';
import { Button, Card, CardBody, CardFooter, CardHeader, Input } from '@nextui-org/react';

import { useApiToken } from '@/app/providers/ApiTokenProvider';
import { getExistingToken, hashToken, setTokenWithExpiry } from '@/app/config/auth';
import { title } from '@/app/components/primitives';

interface LoginPageProps {
  expectedToken?: string;
}

export default function LoginForm({ expectedToken }: Readonly<LoginPageProps>) {
  const { updateApiToken } = useApiToken();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    if (getExistingToken() === hashToken(expectedToken)) {
      updateApiToken(expectedToken);
      setIsAuthenticated(true);
      redirect('/');
    }
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (input === expectedToken) {
      setIsAuthenticated(true);
      setTokenWithExpiry(input);
      updateApiToken(input);
      setError('');

      return;
    }

    setError('invalid API key');
  };

  if (isAuthenticated) {
    redirect('/');
  }

  return (
    <div className="grid col-span-6 justify-center">
      <h1 className={title()}>Login</h1>
      <Card className="h-screen min-w-[340px] max-h-[250px] p-2 mt-10">
        <CardHeader className="content-start max-h-14">
          <p className="text-md">Please provide api key to sign in</p>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardBody className="min-w-full h-24">
            <Input
              fullWidth
              isRequired
              errorMessage={error}
              isInvalid={!!error}
              placeholder="Enter API Key"
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
