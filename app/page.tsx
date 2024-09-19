'use client';
import { useLayoutEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import useQuery from '@/app/hooks/useQuery';
import { type ServerDataInfo } from '@/app/lib/storage';
import ErrorMessage from '@/app/components/error-message';
import FilesystemStatTabs from '@/app/components/fs-stat-tabs';

const localStorageTabKey = 'selectedTab';

const getPersistedSelectedTab = () => {
  return typeof window !== 'undefined' ? (localStorage.getItem(localStorageTabKey) ?? '') : '';
};

const persistSelectedTab = (tab: string) => {
  return typeof window !== 'undefined' && tab && localStorage.setItem(localStorageTabKey, tab);
};

export default function DashboardPage() {
  const { data: info, error, refetch } = useQuery<ServerDataInfo>('/api/info');
  const [selectedTab, setSelectedTab] = useState<string>(getPersistedSelectedTab() ?? '');
  const [refreshId, setRefreshId] = useState<string>(uuidv4());

  useLayoutEffect(() => {
    refetch();
  }, [refreshId]);

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

  return (
    <>
      {error && <ErrorMessage message={error.message} />}
      {!!info && (
        <FilesystemStatTabs info={info} selected={selectedTab} onSelect={onChangeTab} onUpdate={updateRefreshId} />
      )}
    </>
  );
}
