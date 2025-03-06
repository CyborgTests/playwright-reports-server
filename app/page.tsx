'use client';
import { useLayoutEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSession } from 'next-auth/react';
import { Spinner } from '@heroui/react';
import { toast } from 'sonner';

import useQuery from '@/app/hooks/useQuery';
import { type ServerDataInfo } from '@/app/lib/storage';
import FilesystemStatTabs from '@/app/components/fs-stat-tabs';

const localStorageTabKey = 'selectedTab';

const getPersistedSelectedTab = () => {
  return typeof window !== 'undefined' ? (localStorage.getItem(localStorageTabKey) ?? '') : '';
};

const persistSelectedTab = (tab: string) => {
  return typeof window !== 'undefined' && tab && localStorage.setItem(localStorageTabKey, tab);
};

export default function DashboardPage() {
  const { status } = useSession();
  const authIsLoading = status === 'loading';

  const { data: info, error, refetch, isLoading: isInfoLoading } = useQuery<ServerDataInfo>('/api/info');
  const [selectedTab, setSelectedTab] = useState<string>(getPersistedSelectedTab() ?? '');
  const [refreshId, setRefreshId] = useState<string>(uuidv4());

  useLayoutEffect(() => {
    if (authIsLoading) {
      return;
    }
    refetch();
  }, [refreshId]);

  if (authIsLoading || isInfoLoading) {
    return <Spinner />;
  }

  const updateRefreshId = () => {
    setRefreshId(uuidv4());
  };

  const onChangeTab = (key: string | number) => {
    if (typeof key === 'number') {
      return;
    }
    persistSelectedTab(key);
    setSelectedTab(key);
  };

  error && toast.error(error.message);

  return (
    <>
      {!!info && (
        <FilesystemStatTabs info={info} selected={selectedTab} onSelect={onChangeTab} onUpdate={updateRefreshId} />
      )}
    </>
  );
}
