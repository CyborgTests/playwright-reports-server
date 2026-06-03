'use client';

import { Avatar, Button } from '@heroui/react';
import { signOut, useSession } from 'next-auth/react';

export const UserGreeting: React.FC = () => {
  const { data: session, status } = useSession();

  if (status !== 'authenticated') return null;

  const name = session?.user?.name;
  const email = session?.user?.email;
  const image = session?.user?.image ?? undefined;
  const displayName = name || email;

  // In API-token mode there is no name/email on the session, so render nothing —
  // the navbar looks identical to before for non-OAuth deployments.
  if (!displayName) return null;

  return (
    <div className="flex items-center gap-3">
      <Avatar alt={displayName} className="w-7 h-7 text-tiny" name={displayName} src={image} />
      <span className="hidden md:inline text-sm text-default-700">Hi, {displayName}</span>
      <Button size="sm" variant="flat" onPress={() => signOut({ callbackUrl: '/login' })}>
        Sign out
      </Button>
    </div>
  );
};
