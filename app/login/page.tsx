'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardBody, CardFooter, CardHeader, Input } from '@nextui-org/react';

import { getExistingToken, hashToken, setTokenWithExpiry } from '@/app/config/auth';
import { title } from '@/app/components/primitives';
import { getEnvVariables } from '@/app/actions/env';
import { useApiToken } from '@/app/providers/ApiTokenProvider';

export default function LoginForm() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [expectedToken, setExpectedToken] = useState('');
  const [expiration, setExpiration] = useState(12);
  const router = useRouter();

  const { isClientAuthorized } = useApiToken();

  useEffect(() => {
    if (isClientAuthorized()) {
      setIsAuthenticated(true);

      return;
    }

    getEnvVariables().then(({ token, expirationHours }) => {
      setExpectedToken(token ?? '');

      if (!token) {
        setIsAuthenticated(true);

        return;
      }

      const expireAt = !!expirationHours ? parseInt(expirationHours, 10) : 12;

      setExpiration(expireAt);

      if (getExistingToken(expireAt) === hashToken(token)) {
        setIsAuthenticated(true);
      }
    });
  }, [expectedToken]);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (input === expectedToken) {
      setTokenWithExpiry(input, expiration);
      setError('');
      setIsAuthenticated(true);

      return;
    }

    setError('invalid API key');
  };

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
