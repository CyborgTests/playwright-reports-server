import {
  CAPABILITIES,
  can,
  ROOT_CAUSE_CATEGORIES,
  ROOT_CAUSE_CATEGORY_DESCRIPTIONS,
  type RootCauseCategory,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import type { FC } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { formatCategoryName } from '@/lib/format';
import { invalidateCache } from '@/lib/query-cache';

interface AnalysisResponse {
  data: { category?: string | null } | null;
}

interface Props {
  testId: string;
  reportId: string;
  project: string;
}

const RootCauseCategoryEditor: FC<Props> = ({ testId, reportId, project }) => {
  const session = useAuth();
  const canEdit = can(session.data?.user.role ?? null, CAPABILITIES.contentTests);
  const queryClient = useQueryClient();

  const { data } = useQuery<AnalysisResponse>(
    `/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(reportId)}`,
    { dependencies: [testId, reportId], enabled: !!testId && !!reportId }
  );
  const category = data?.data?.category ?? null;

  const { mutate, isPending } = useMutation('/api/test-analysis', {
    method: 'PATCH',
    onSuccess: () => {
      invalidateCache(queryClient, { predicate: '/api/test-analysis' });
      toast.success('Root cause updated');
    },
  });

  if (!category && !canEdit) return null;

  const label = category ? formatCategoryName(category) : 'Set root cause';

  if (!canEdit) {
    return (
      <Badge variant="secondary" className="font-mono text-xs">
        {label}
      </Badge>
    );
  }

  const onSelect = (value: RootCauseCategory) => {
    if (value === category) return;
    mutate({
      body: { reportId, category: value },
      path: `/api/test-analysis/${encodeURIComponent(testId)}?project=${encodeURIComponent(project)}`,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isPending}>
        <button type="button" className="inline-flex">
          <Badge variant="secondary" className="font-mono text-xs cursor-pointer hover:opacity-80">
            {label}
            <ChevronDown className="h-3 w-3 ml-1 opacity-70" />
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ROOT_CAUSE_CATEGORIES.map((value) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => onSelect(value)}
            title={ROOT_CAUSE_CATEGORY_DESCRIPTIONS[value]}
          >
            {formatCategoryName(value)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default RootCauseCategoryEditor;
