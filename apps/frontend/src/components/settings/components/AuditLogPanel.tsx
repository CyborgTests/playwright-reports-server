import type { AuditLogEntry, PaginationResponse } from '@playwright-reports/shared';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { useState } from 'react';
import FormattedDate from '@/components/date-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import appUseQuery from '@/hooks/useQuery';

const PAGE_SIZE = 25;

export default function AuditLogPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [page, setPage] = useState(1);

  const { data, isLoading } = appUseQuery<PaginationResponse<AuditLogEntry>>(
    `/api/audit?page=${page}&limit=${PAGE_SIZE}`,
    { enabled: !collapsed, dependencies: [page], staleTime: 30_000 }
  );

  const rows = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <Card id="audit" className="mb-6 scroll-mt-20 p-4">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 text-left hover:opacity-80"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <ScrollText className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Audit Log</h2>
      </button>

      {!collapsed && (
        <CardContent className="px-0 pt-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-1 py-3 text-xs italic text-muted-foreground">No audit events yet.</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} events
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasMore}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function AuditRow({ entry }: Readonly<{ entry: AuditLogEntry }>) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded border bg-card px-3 py-2 text-xs">
      <Badge variant="outline" className="font-mono text-[10px]">
        {entry.action}
      </Badge>
      <div className="min-w-0">
        <span className="break-words">
          {entry.actor ?? 'system'}
          {entry.target ? ` → ${entry.target}` : ''}
        </span>
        {entry.detail && (
          <div className="mt-0.5 break-words text-muted-foreground">{entry.detail}</div>
        )}
      </div>
      <span className="whitespace-nowrap text-muted-foreground">
        <FormattedDate date={entry.ts} />
      </span>
    </div>
  );
}
