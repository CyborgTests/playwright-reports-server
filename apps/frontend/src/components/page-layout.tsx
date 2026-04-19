import type { ServerDataInfo } from '@playwright-reports/shared';
import { useEffect, useLayoutEffect } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { useConfig } from '../hooks/useConfig';
import useQuery from '../hooks/useQuery';
import { Spinner } from './ui/spinner';

interface PageLayoutProps {
  render: (props: { info: ServerDataInfo; onUpdate: () => void }) => React.ReactNode;
}

export default function PageLayout({ render }: Readonly<PageLayoutProps>) {
  const session = useAuth();
  const status = session.status;
  const authIsLoading = status === 'loading';
  const { data: configData } = useConfig();
  const authRequired = configData?.authRequired ?? null;
  const isAuthenticated = authRequired === false || status === 'authenticated';

  const {
    data: info,
    error,
    refetch,
    isLoading: isInfoLoading,
  } = useQuery<ServerDataInfo>('/api/info', {
    enabled: isAuthenticated,
  });

  useEffect(() => {
    // Only show error if auth is required
    if (authRequired === false) {
      return;
    }

    if (!authIsLoading && session.status === 'unauthenticated' && authRequired === true) {
      toast.error('You are not authenticated');
    }
  }, [authIsLoading, session, authRequired]);

  useLayoutEffect(() => {
    if (authRequired && (authIsLoading || session.status === 'unauthenticated')) {
      return;
    }

    refetch({ cancelRefetch: false });
  }, [session, authRequired, authIsLoading, refetch]);

  if (authIsLoading || isInfoLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    toast.error(error.message);
    return <div>Error loading data: {error.message}</div>;
  }

  return (
    <>
      {!!info && (
        <div className="space-y-6">
          <div className="gap-10">{render({ info, onUpdate: () => refetch() })}</div>
        </div>
      )}
    </>
  );
}
