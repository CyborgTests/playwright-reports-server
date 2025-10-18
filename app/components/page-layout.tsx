'use client';

import { useLayoutEffect, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSession } from 'next-auth/react';
import { Spinner } from '@heroui/react';
import { toast } from 'sonner';

import useQuery from '@/app/hooks/useQuery';
import { type ServerDataInfo } from '@/app/lib/storage';
import { SiteWhiteLabelConfig } from '@/app/types';

interface PageLayoutProps {
  render: (props: { info: ServerDataInfo; onUpdate: () => void }) => React.ReactNode;
}

export default function PageLayout({ render }: PageLayoutProps) {
  const { data: session, status } = useSession();
  const authIsLoading = status === 'loading';
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);

  const { data: info, error, refetch, isLoading: isInfoLoading } = useQuery<ServerDataInfo>('/api/info');
  const [refreshId, setRefreshId] = useState<string>(uuidv4());

  // Check if auth is required
  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((config: SiteWhiteLabelConfig) => {
        setAuthRequired(config.authRequired ?? false);
      })
      .catch(() => {
        // Fallback: assume auth is required if we can't fetch config
        setAuthRequired(true);
      });
  }, []);

  useEffect(() => {
    // Only show error if auth is required
    if (authRequired === false) {
      return;
    }

    if (!authIsLoading && !session && authRequired === true) {
      toast.error('You are not authenticated');
    }
  }, [authIsLoading, session, authRequired]);

  useLayoutEffect(() => {
    // Skip session check if auth is not required
    if (authRequired === false) {
      refetch();

      return;
    }

    if (authIsLoading || !session) {
      return;
    }
    refetch();
  }, [refreshId, session, authRequired]);

  if (authIsLoading || isInfoLoading) {
    return <Spinner className="flex justify-center items-center" />;
  }

  const updateRefreshId = () => {
    setRefreshId(uuidv4());
  };

  if (error) {
    toast.error(error.message);

    return <div>Error loading data: {error.message}</div>;
  }

  return (
    <>
      {!!info && (
        <div className="space-y-6">
          <div className="gap-10">{render({ info, onUpdate: updateRefreshId })}</div>
        </div>
      )}
    </>
  );
}
