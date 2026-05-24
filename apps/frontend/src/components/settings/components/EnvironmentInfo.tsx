'use client';

import type { ServerDataInfo } from '@playwright-reports/shared';
import {
  Activity,
  Cloud,
  Database,
  FileArchive,
  FileText,
  HardDrive,
  Lock,
  LockOpen,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfig } from '@/hooks/useConfig';
import useQuery from '@/hooks/useQuery';

interface FactChipProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: 'default' | 'muted';
}

function FactChip({ icon: Icon, label, value, tone = 'default' }: FactChipProps) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        tone === 'muted' ? 'bg-muted/40' : 'bg-card'
      }`}
    >
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export default function EnvironmentInfo() {
  const { data: envInfo, isLoading } = useConfig();
  const { data: serverInfo } = useQuery<ServerDataInfo>('/api/info');

  if (isLoading) {
    return (
      <Card id="environment" className="mb-6 scroll-mt-20 p-4">
        <CardHeader>
          <h2 className="text-xl font-semibold">Environment Information</h2>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-40 rounded-lg" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const dbStats = envInfo?.database;
  const storage = envInfo?.dataStorage ?? 'fs';

  // Each chip is rendered only when the underlying value is meaningful so
  // unknown / undefined fields drop out instead of surfacing as text.
  return (
    <Card id="environment" className="mb-6 scroll-mt-20 p-4">
      <CardHeader>
        <h2 className="text-xl font-semibold">Environment Information</h2>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <FactChip
            icon={envInfo?.authRequired ? Lock : LockOpen}
            label="Auth"
            value={envInfo?.authRequired ? 'Enabled' : 'Disabled'}
          />
          <FactChip icon={HardDrive} label="Storage" value={storage} />
          {dbStats?.sizeOnDisk && (
            <FactChip icon={Database} label="DB size" value={dbStats.sizeOnDisk} />
          )}
          {dbStats?.estimatedRAM && (
            <FactChip icon={Activity} label="DB RAM" value={dbStats.estimatedRAM} tone="muted" />
          )}
          {typeof dbStats?.reports === 'number' && (
            <FactChip icon={FileText} label="Reports" value={dbStats.reports.toString()} />
          )}
          {typeof dbStats?.results === 'number' && (
            <FactChip icon={FileArchive} label="Results" value={dbStats.results.toString()} />
          )}
          {storage === 's3' && envInfo?.s3Endpoint && (
            <FactChip
              icon={Cloud}
              label="S3"
              value={`${envInfo.s3Bucket ?? 'bucket'} @ ${envInfo.s3Endpoint}`}
            />
          )}
          {storage === 'azure' && envInfo?.azureAccountName && (
            <FactChip
              icon={Cloud}
              label="Azure"
              value={`${envInfo.azureContainer ?? 'container'} @ ${envInfo.azureAccountName}`}
            />
          )}
          {serverInfo?.dataFolderSizeinMB && (
            <FactChip
              icon={HardDrive}
              label="Total"
              value={serverInfo.dataFolderSizeinMB}
              tone="muted"
            />
          )}
          {serverInfo?.reportsFolderSizeinMB && (
            <FactChip
              icon={FileText}
              label="Reports size"
              value={serverInfo.reportsFolderSizeinMB}
              tone="muted"
            />
          )}
          {serverInfo?.resultsFolderSizeinMB && (
            <FactChip
              icon={FileArchive}
              label="Results size"
              value={serverInfo.resultsFolderSizeinMB}
              tone="muted"
            />
          )}
          {serverInfo?.availableSizeinMB && (
            <FactChip
              icon={HardDrive}
              label="Available"
              value={serverInfo.availableSizeinMB}
              tone="muted"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
