'use client';

import type { ServerDataInfo } from '@playwright-reports/shared';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfig } from '@/hooks/useConfig';
import useQuery from '@/hooks/useQuery';
import DatabaseInfo from './DatabaseInfo';

export default function EnvironmentInfo() {
  const { data: envInfo, isLoading } = useConfig();
  const { data: serverInfo } = useQuery<ServerDataInfo>('/api/info');

  return (
    <Card className="p-4">
      <CardHeader>
        <h2 className="text-xl font-semibold">Environment Information</h2>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-medium mb-1">Authentication</span>
            {isLoading ? (
              <Skeleton className="h-5 w-20 rounded-lg" />
            ) : (
              <p className="text-sm text-muted-foreground">
                {envInfo?.authRequired ? 'Enabled' : 'Disabled'}
              </p>
            )}
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Database</span>
            {isLoading ? (
              <Skeleton className="h-5 w-20 rounded-lg" />
            ) : (
              <DatabaseInfo stats={envInfo?.database} />
            )}
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Data Storage</span>
            {isLoading ? (
              <Skeleton className="h-5 w-20 rounded-lg" />
            ) : (
              <p className="text-sm text-muted-foreground">{envInfo?.dataStorage || 'fs'}</p>
            )}
          </div>
          {envInfo?.dataStorage === 's3' && envInfo?.s3Endpoint && (
            <div>
              <span className="block text-sm font-medium mb-1">S3 Storage</span>
              <p className="text-sm text-muted-foreground">Endpoint: {envInfo.s3Endpoint}</p>
              <p className="text-sm text-muted-foreground">Bucket: {envInfo.s3Bucket}</p>
            </div>
          )}
          {envInfo?.dataStorage === 'azure' && envInfo?.azureAccountName && (
            <div>
              <span className="block text-sm font-medium mb-1">Azure Blob Storage</span>
              <p className="text-sm text-muted-foreground">Account: {envInfo.azureAccountName}</p>
              <p className="text-sm text-muted-foreground">Container: {envInfo.azureContainer}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">Total: {serverInfo?.dataFolderSizeinMB}</p>
          <p className="text-sm text-muted-foreground">
            Reports: {serverInfo?.reportsFolderSizeinMB}
          </p>
          <p className="text-sm text-muted-foreground">
            Results: {serverInfo?.resultsFolderSizeinMB}
          </p>
          <p className="text-sm text-muted-foreground">
            Available: {serverInfo?.availableSizeinMB}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
