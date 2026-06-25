import {
  CAPABILITIES,
  type ClusterTest,
  can,
  ROOT_CAUSE_CATEGORIES,
  ROOT_CAUSE_CATEGORY_DESCRIPTIONS,
  type RootCauseCategory,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import useMutation from '@/hooks/useMutation';
import { formatCategoryName } from '@/lib/format';
import { invalidateCache } from '@/lib/query-cache';

interface Props {
  tests: ClusterTest[];
}

const ClusterRootCauseBulkEditor = ({ tests }: Props) => {
  const session = useAuth();
  const canEdit = can(session.data?.user.role ?? null, CAPABILITIES.contentTests);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { mutateAsync } = useMutation('/api/test-analysis', { method: 'PATCH', silent: true });

  if (!canEdit) return null;

  const targets = tests.filter((t) => !!t.lastReportId);

  const applyToAll = async (category: RootCauseCategory) => {
    if (targets.length === 0) {
      toast.error('No member tests with a known report to update');
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      targets.map(async (t) => {
        try {
          await mutateAsync({
            body: { reportId: t.lastReportId, category },
            path: `/api/test-analysis/${encodeURIComponent(t.testId)}?project=${encodeURIComponent(t.project)}`,
          });
          ok += 1;
        } catch {
          failed += 1;
        }
      })
    );
    setBusy(false);
    invalidateCache(queryClient, { predicate: '/api/test-analysis' });
    const skipped = tests.length - targets.length;
    toast.success(
      `Root cause set for ${ok} test${ok === 1 ? '' : 's'}` +
        (failed ? `, ${failed} failed` : '') +
        (skipped ? `, ${skipped} skipped` : '')
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy}>
        <Button variant="outline" size="sm">
          {busy ? 'Applying…' : 'Set root cause for all'}
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ROOT_CAUSE_CATEGORIES.map((value) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => applyToAll(value)}
            title={ROOT_CAUSE_CATEGORY_DESCRIPTIONS[value]}
          >
            {formatCategoryName(value)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ClusterRootCauseBulkEditor;
