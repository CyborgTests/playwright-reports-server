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
import type { ComponentType, ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfig } from '@/hooks/useConfig';
import useQuery from '@/hooks/useQuery';

interface FactChipProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

function FactChip({ icon: Icon, label, value }: FactChipProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm whitespace-nowrap">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

interface FactGroupProps {
  title: string;
  children: ReactNode;
}

function FactGroup({ title, children }: FactGroupProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
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

  // Groups: Database, Reports, Results, Storage. Chips render only when their
  // value is meaningful — empty groups stay hidden instead of showing a header
  // with no facts under it.
  const dbChips: ReactNode[] = [];
  if (dbStats?.sizeOnDisk)
    dbChips.push(
      <FactChip key="db-size" icon={Database} label="Size" value={dbStats.sizeOnDisk} />
    );
  if (dbStats?.estimatedRAM)
    dbChips.push(
      <FactChip key="db-ram" icon={Activity} label="RAM" value={dbStats.estimatedRAM} />
    );

  const reportsChips: ReactNode[] = [];
  if (typeof dbStats?.reports === 'number')
    reportsChips.push(
      <FactChip key="rep-count" icon={FileText} label="Count" value={dbStats.reports.toString()} />
    );
  if (serverInfo?.reportsFolderSizeinMB)
    reportsChips.push(
      <FactChip
        key="rep-size"
        icon={HardDrive}
        label="Disk"
        value={serverInfo.reportsFolderSizeinMB}
      />
    );

  const resultsChips: ReactNode[] = [];
  if (typeof dbStats?.results === 'number')
    resultsChips.push(
      <FactChip
        key="res-count"
        icon={FileArchive}
        label="Count"
        value={dbStats.results.toString()}
      />
    );
  if (serverInfo?.resultsFolderSizeinMB)
    resultsChips.push(
      <FactChip
        key="res-size"
        icon={HardDrive}
        label="Disk"
        value={serverInfo.resultsFolderSizeinMB}
      />
    );

  const storageChips: ReactNode[] = [
    <FactChip
      key="auth"
      icon={envInfo?.authRequired ? Lock : LockOpen}
      label="Auth"
      value={envInfo?.authRequired ? 'Enabled' : 'Disabled'}
    />,
    <FactChip key="backend" icon={HardDrive} label="Backend" value={storage} />,
  ];
  if (storage === 's3' && envInfo?.s3Endpoint)
    storageChips.push(
      <FactChip
        key="s3"
        icon={Cloud}
        label="S3"
        value={`${envInfo.s3Bucket ?? 'bucket'} @ ${envInfo.s3Endpoint}`}
      />
    );
  if (storage === 'azure' && envInfo?.azureAccountName)
    storageChips.push(
      <FactChip
        key="azure"
        icon={Cloud}
        label="Azure"
        value={`${envInfo.azureContainer ?? 'container'} @ ${envInfo.azureAccountName}`}
      />
    );
  if (serverInfo?.dataFolderSizeinMB)
    storageChips.push(
      <FactChip key="total" icon={HardDrive} label="Used" value={serverInfo.dataFolderSizeinMB} />
    );
  if (serverInfo?.availableSizeinMB)
    storageChips.push(
      <FactChip
        key="available"
        icon={HardDrive}
        label="Available"
        value={serverInfo.availableSizeinMB}
      />
    );

  return (
    <Card id="environment" className="mb-6 scroll-mt-20 p-4">
      <CardHeader>
        <h2 className="text-xl font-semibold">Environment Information</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        {dbChips.length > 0 && <FactGroup title="Database">{dbChips}</FactGroup>}
        {reportsChips.length > 0 && <FactGroup title="Reports">{reportsChips}</FactGroup>}
        {resultsChips.length > 0 && <FactGroup title="Results">{resultsChips}</FactGroup>}
        <FactGroup title="Storage">{storageChips}</FactGroup>
      </CardContent>
    </Card>
  );
}
