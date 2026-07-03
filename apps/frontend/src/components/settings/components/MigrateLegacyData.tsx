import type { ReadReportsHistory } from '@playwright-reports/shared';
import { CAPABILITIES } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useHasCapability } from '@/hooks/useHasCapability';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';

interface LegacyImportSummary {
  reports: { imported: number; skipped: number; total: number };
  results: { imported: number; skipped: number; total: number };
  errors: string[];
}

interface LegacyImportStatus {
  phase: 'idle' | 'running' | 'done' | 'failed';
  summary: LegacyImportSummary;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

const STATUS_PATH = '/api/admin/migrate-legacy/status';
const START_PATH = '/api/admin/migrate-legacy';

function ProgressLine({
  label,
  counts,
}: {
  label: string;
  counts: { imported: number; skipped: number; total: number };
}) {
  const done = counts.imported + counts.skipped;
  return (
    <p>
      {label}: <strong>{done}</strong>
      {counts.total > 0 ? ` / ${counts.total}` : ''} ({counts.imported} imported, {counts.skipped}{' '}
      skipped)
    </p>
  );
}

export default function MigrateLegacyData() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const canConfigure = useHasCapability()(CAPABILITIES.configServer);

  const { data } = useQuery<{ status: LegacyImportStatus }>(STATUS_PATH, {
    enabled: canConfigure,
    refetchInterval: (query) => (query.state.data?.status.phase === 'running' ? 2000 : false),
  });
  const status = data?.status;
  const phase = status?.phase ?? 'idle';
  const running = phase === 'running';

  const { data: reports } = useQuery<ReadReportsHistory>('/api/report/list?limit=1', {
    enabled: canConfigure,
  });
  const newestCreatedAt = reports?.reports[0]?.createdAt;
  const hasNewReports =
    !!newestCreatedAt &&
    (!status?.finishedAt || Date.parse(newestCreatedAt) > Date.parse(status.finishedAt));

  const { mutate: startImport, isPending } = useMutation(START_PATH, {
    onSuccess: () => {
      setOpen(false);
      toast.success('Import started');
      queryClient.invalidateQueries({ queryKey: [STATUS_PATH] });
    },
  });

  if (!canConfigure || (!running && hasNewReports)) return null;

  return (
    <Card className="mb-6 p-4 scroll-mt-20" id="migrate">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <DatabaseBackup className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Data Migration</h2>
          </div>
          <CardDescription>
            Import reports and results from the original file-based server. Runs once, only while no
            reports exist yet. Blobs are not copied - they are served in place from their original
            location.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={running}>
              {running ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Importing…
                </>
              ) : (
                'Import legacy data'
              )}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import legacy data?</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    This scans the configured storage for legacy reports and results and registers
                    them in the database.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Runs only while the reports table is empty (one-time).</li>
                    <li>Does not move or copy any files - reports are served in place.</li>
                    <li>
                      Runs in the background and may take several minutes on large datasets; you can
                      leave this page.
                    </li>
                  </ul>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} variant="outline">
                Cancel
              </Button>
              <Button disabled={isPending} onClick={() => startImport({})}>
                {isPending && <Spinner className="mr-2 h-4 w-4" />}
                Run import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>

      {status && phase !== 'idle' && (
        <CardContent className="space-y-2 text-sm">
          {running && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner className="h-4 w-4" />
              <span>Importing… you can leave this page; progress continues on the server.</span>
            </div>
          )}
          {phase === 'done' && <p className="font-medium text-success">Import complete.</p>}
          {phase === 'failed' && (
            <p className="font-medium text-destructive">Import failed: {status.error}</p>
          )}
          <ProgressLine label="Reports" counts={status.summary.reports} />
          <ProgressLine label="Results" counts={status.summary.results} />
          {status.summary.errors.length > 0 && (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer text-destructive">
                {status.summary.errors.length} error
                {status.summary.errors.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 list-disc pl-5">
                {status.summary.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      )}
    </Card>
  );
}
