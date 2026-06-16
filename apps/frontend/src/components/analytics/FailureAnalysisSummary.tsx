import type { ProjectAnalysisStructured } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, RefreshCw } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfig } from '@/hooks/useConfig';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';
import { LlmAnalysisRenderer, VerdictBadge } from './LlmAnalysisRenderer';

interface CachedProjectSummary {
  project: string;
  summary: string;
  /** Parsed structured payload — null for legacy rows generated before 5.1. */
  structured: ProjectAnalysisStructured | null;
  model: string | null;
  updatedAt: string;
  reportCount: number | null;
  firstReportAt: string | null;
  lastReportAt: string | null;
  /** True when newer reports have been ingested since the analysis ran. */
  isStale?: boolean;
  /** True when the analysis trails the latest report by ≥7 days — UI hides
   *  the verdict and prompts a re-generate. */
  isTooStale?: boolean;
  /** Server's view of the current newest report's createdAt — used for the
   *  "X days behind" hint in the stale badge. */
  currentLatestReportAt?: string;
}

interface CachedSummaryResponse {
  success: boolean;
  data: CachedProjectSummary | null;
  pendingAnalysisCount?: number;
}

interface EnqueueResponse {
  success: boolean;
  data?: { taskId?: string; deduped?: boolean; allGreen?: boolean };
  error?: string;
}

interface FailureAnalysisSummaryProps {
  project?: string;
  totalFailures?: number;
  reportIds?: string[];
}

export function FailureAnalysisSummary({
  project,
  totalFailures,
  reportIds,
}: Readonly<FailureAnalysisSummaryProps>) {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const llmConfigured = !!config?.llm?.baseUrl;

  const cacheParams = new URLSearchParams();
  if (project && project !== defaultProjectName) cacheParams.append('project', project);
  const cachePath = `/api/analytics/project-summary?${cacheParams.toString()}`;

  const { data: cached, isLoading } = useQuery<CachedSummaryResponse>(cachePath, {
    dependencies: [project],
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as CachedSummaryResponse | undefined;
      return (data?.pendingAnalysisCount ?? 0) > 0 ? 5000 : false;
    },
  });

  const enqueuePath = `/api/analytics/failure-categories/llm?${cacheParams.toString()}`;
  const { mutate: enqueueAnalysis, isPending: isEnqueuing } = useMutation<
    EnqueueResponse,
    { reportIds?: string[] }
  >(enqueuePath, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [cachePath] });
    },
  });

  const summary = cached?.data ?? null;
  const pendingAnalysisCount = cached?.pendingAnalysisCount ?? 0;
  const hasOngoingAnalysis = pendingAnalysisCount > 0 || isEnqueuing;

  if (isLoading) {
    return null;
  }

  if (!summary && !llmConfigured) {
    return null;
  }

  if (totalFailures === 0 && !summary) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="text-center text-sm text-muted-foreground">
            No failures observed in the latest reports. Good job!
          </div>
        </CardContent>
      </Card>
    );
  }

  const ongoingButton = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button size="sm" variant="outline" disabled>
              <Spinner size="sm" className="mr-1" />
              Analysis ongoing
              {pendingAnalysisCount > 0 ? ` (${pendingAnalysisCount})` : ''}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Analysis ongoing — check the{' '}
          <RouterLink to="/llm-queue" className="underline">
            LLM queue
          </RouterLink>
          .
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const structured = summary?.structured ?? null;
  // `isTooStale` → the cached analysis trails the newest report by ≥7 days.
  // Hide the verdict content and prompt the user to re-generate. We still
  // show the card and the regenerate button so the action is obvious.
  const showVerdict = !!summary && !summary.isTooStale;
  // `isStale` → newer reports exist but the analysis is still fresh enough
  // to surface as supporting context (with a badge calling out the gap).
  const showStaleBadge = !!summary && summary.isStale && !summary.isTooStale;
  const daysBehind =
    summary?.lastReportAt && summary?.currentLatestReportAt
      ? Math.max(
          0,
          Math.round(
            (new Date(summary.currentLatestReportAt).getTime() -
              new Date(summary.lastReportAt).getTime()) /
              86_400_000
          )
        )
      : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-semibold">LLM Failure Analysis</h3>
              {showVerdict && structured && <VerdictBadge verdict={structured.verdict} />}
              {showStaleBadge && (
                <Badge variant="warning" title={`Newer reports ingested since this analysis ran`}>
                  Stale{daysBehind > 0 ? ` · ${daysBehind}d behind` : ''}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Test health analysis based on the latest 20 runs
            </p>
          </div>
          {hasOngoingAnalysis
            ? ongoingButton
            : llmConfigured && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => enqueueAnalysis({ body: { reportIds } })}
                >
                  {summary ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-1" /> Re-generate
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4 mr-1" /> Generate Analysis
                    </>
                  )}
                </Button>
              )}
        </div>
      </CardHeader>
      <CardContent>
        {hasOngoingAnalysis && !showVerdict && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Spinner size="sm" />
            <span className="text-muted-foreground">
              LLM is analyzing latest runs — track progress on the{' '}
              <RouterLink to="/llm-queue" className="underline">
                LLM queue
              </RouterLink>
              .
            </span>
          </div>
        )}
        {showVerdict && summary && (
          <div className="space-y-3">
            {structured ? (
              <LlmAnalysisRenderer analysis={structured} fallbackProject={project} />
            ) : (
              <MarkdownRenderer content={summary.summary} />
            )}
            {(summary.model || summary.updatedAt || summary.reportCount) && (
              <div className="flex items-center gap-2 pt-3 border-t text-xs text-muted-foreground flex-wrap">
                {summary.model && <Badge variant="outline">{summary.model}</Badge>}
                {summary.reportCount &&
                  summary.reportCount > 0 &&
                  summary.firstReportAt &&
                  summary.lastReportAt && (
                    <span>
                      {summary.reportCount} {summary.reportCount === 1 ? 'report' : 'reports'}{' '}
                      analyzed · {new Date(summary.firstReportAt).toLocaleDateString()} —{' '}
                      {new Date(summary.lastReportAt).toLocaleDateString()}
                    </span>
                  )}
                {summary.updatedAt && (
                  <span className="ml-auto">
                    Generated {new Date(summary.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {!hasOngoingAnalysis && summary?.isTooStale && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Previous analysis was generated{' '}
            {summary.updatedAt && new Date(summary.updatedAt).toLocaleDateString()} and is now{' '}
            {daysBehind} days behind the latest run. Click "Re-generate" for an up-to-date verdict.
          </div>
        )}
        {!hasOngoingAnalysis && !summary && llmConfigured && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Click "Generate Analysis" to get an LLM-powered health analysis of the latest runs
          </div>
        )}
      </CardContent>
    </Card>
  );
}
