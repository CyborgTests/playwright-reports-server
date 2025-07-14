'use client';

import { useLayoutEffect, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSession } from 'next-auth/react';
import { Spinner } from '@heroui/react';
import { toast } from 'sonner';

import useQuery from '@/app/hooks/useQuery';
import { type ServerDataInfo } from '@/app/lib/storage';

interface PageLayoutProps {
  render: (props: { info: ServerDataInfo; onUpdate: () => void }) => React.ReactNode;
  title: string;
}

export default function PageLayout({ render }: PageLayoutProps) {
  const { data: session, status } = useSession();
  const authIsLoading = status === 'loading';

  const { data: info, error, refetch, isLoading: isInfoLoading } = useQuery<ServerDataInfo>('/api/info');
  const [refreshId, setRefreshId] = useState<string>(uuidv4());

  useEffect(() => {
    if (!authIsLoading && !session) {
      toast.error('You are not authenticated');
    }
  }, [authIsLoading, session]);

  useLayoutEffect(() => {
    if (authIsLoading || !session) {
      return;
    }
    refetch();
  }, [refreshId, session]);

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