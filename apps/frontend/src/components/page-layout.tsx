import type { ServerDataInfo } from '@playwright-reports/shared';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import useQuery from '../hooks/useQuery';
import { Spinner } from './ui/spinner';

interface PageLayoutProps {
  render: (props: { info: ServerDataInfo; onUpdate: () => void }) => React.ReactNode;
}

export default function PageLayout({ render }: Readonly<PageLayoutProps>) {
  const {
    data: info,
    error,
    refetch,
    isLoading: isInfoLoading,
  } = useQuery<ServerDataInfo>('/api/info');

  const onUpdate = useCallback(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  if (isInfoLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <div>Error loading data: {error.message}</div>;
  }

  if (!info) return null;

  return (
    <div className="space-y-6">
      <div className="gap-10">{render({ info, onUpdate })}</div>
    </div>
  );
}
