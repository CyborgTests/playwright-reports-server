import {
  CLEANUP_KINDS,
  CLEANUP_RULES,
  type CleanupEstimate,
  type CleanupKind,
  type CronConfig,
  cleanupDays,
  isCleanupConfirmed,
  validateCleanupWindows,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CONFIG_QUERY_KEY } from '@/hooks/useConfig';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { cn } from '@/lib/utils';
import {
  CLEANUP_ESTIMATES_KEY,
  cleanupDepth,
  describeEstimate,
  ROW_ORDER,
} from './cleanup-helpers';

interface CleanupRulesProps {
  saved: CronConfig;
  draft: CronConfig;
  isEditing: boolean;
  onDaysChange: (kind: CleanupKind, value: string) => void;
}

export default function CleanupRules({
  saved,
  draft,
  isEditing,
  onDaysChange,
}: Readonly<CleanupRulesProps>) {
  const queryClient = useQueryClient();
  const windows = new URLSearchParams();
  for (const kind of CLEANUP_KINDS) {
    const days = draft[CLEANUP_RULES[kind].daysKey];
    if (days) windows.set(kind, String(days));
  }
  const query = useDebouncedValue(windows.toString(), 400);
  const { data } = useQuery<{ estimates: CleanupEstimate[] }>(`${CLEANUP_ESTIMATES_KEY}?${query}`, {
    queryKey: [CLEANUP_ESTIMATES_KEY, query],
  });
  const confirmRule = useMutation<{ success: boolean }, { kind: CleanupKind; days: number }>(
    '/api/config/cleanup-confirm',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: [CLEANUP_ESTIMATES_KEY] });
      },
    }
  );

  const issues = validateCleanupWindows(draft);
  const byKind = new Map((data?.estimates ?? []).map((estimate) => [estimate.kind, estimate]));

  return (
    <div className="space-y-1">
      {ROW_ORDER.map((kind) => {
        const rule = CLEANUP_RULES[kind];
        const draftDays = draft[rule.daysKey];
        const savedDays = cleanupDays(saved, kind);
        const confirmed = isCleanupConfirmed(saved, kind);
        const estimate = byKind.get(kind);
        const issue = issues.find((candidate) => candidate.field === rule.daysKey);
        const estimateMatchesDraft = estimate?.days === draftDays;
        const canConfirm = estimate?.days === savedDays;

        return (
          <div
            key={kind}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-md border px-3 py-2',
              issue ? 'border-danger/50 bg-danger/[0.03]' : 'border-transparent',
              kind === 'results' && 'mt-3 border-t border-t-border/60'
            )}
            style={{ marginLeft: `${cleanupDepth(kind) * 20}px` }}
          >
            <div className="w-60 shrink-0">
              <div className="text-sm font-medium">{rule.label}</div>
              <p className="text-xs leading-snug text-muted-foreground">{rule.description}</p>
            </div>

            <Input
              aria-label={`${rule.label} retention in days`}
              type="number"
              inputMode="numeric"
              placeholder="off"
              className="w-24 font-mono"
              disabled={!isEditing}
              value={draftDays?.toString() ?? ''}
              onChange={(event) => onDaysChange(kind, event.target.value)}
            />
            <span className="text-xs text-muted-foreground">days</span>

            {savedDays === undefined ? (
              <Badge variant="outline" className="text-muted-foreground">
                off
              </Badge>
            ) : confirmed ? (
              <Badge variant="success">confirmed</Badge>
            ) : (
              <Badge variant="warning">needs confirmation</Badge>
            )}

            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs text-muted-foreground',
                !estimateMatchesDraft && 'italic opacity-60'
              )}
            >
              {draftDays === undefined ? '' : describeEstimate(kind, estimate)}
              {!!estimate?.unmeasured && (
                <span className="text-warning">
                  {' '}
                  (+{estimate.unmeasured.toLocaleString()} not yet measured)
                </span>
              )}
            </span>

            {savedDays !== undefined && !confirmed && !isEditing && (
              <Button
                size="sm"
                variant="outline"
                disabled={confirmRule.isPending || !canConfirm}
                title={canConfirm ? undefined : 'Recalculating what this rule would delete'}
                onClick={() => confirmRule.mutate({ body: { kind, days: savedDays } })}
              >
                {confirmRule.isPending && confirmRule.variables?.body?.kind === kind
                  ? 'Confirming…'
                  : 'Confirm'}
              </Button>
            )}

            {issue && (
              <div className="flex w-full items-center gap-2 text-xs text-danger">
                <span>{issue.message}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  disabled={!isEditing}
                  onClick={() => onDaysChange(kind, String(issue.suggestedDays))}
                >
                  Set to {issue.suggestedDays}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
