'use client';

import type { DatabaseStats } from '@playwright-reports/shared';

interface DatabaseInfoProps {
  stats?: DatabaseStats;
}

export default function DatabaseInfo({ stats }: Readonly<DatabaseInfoProps>) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">Size: {stats?.sizeOnDisk ?? 'n/a'}</p>
      <p className="text-sm text-muted-foreground">RAM: {stats?.estimatedRAM}</p>
      <p className="text-sm text-muted-foreground">Results: {stats?.results}</p>
      <p className="text-sm text-muted-foreground">Reports: {stats?.reports}</p>
    </div>
  );
}
