'use client';

import type { DateRange } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, RefreshCw } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';

interface CachedProjectSummary {
  project: string;
  summary: string;
  model: string | null;
  updatedAt: string;
  reportCount: number | null;
  firstReportAt: string | null;
  lastReportAt: string | null;
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
  // Kept for API compatibility with the dashboard wiring; the queue handler
  // always uses the latest 10 reports for the project, so range is ignored.
  dateRange?: DateRange;
}

export function FailureAnalysisSummary({
  project,
  totalFailures,
}: Readonly<FailureAnalysisSummaryProps>) {
  const queryClient = useQueryClient();

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
  const { mutate: enqueueAnalysis, isPending: isEnqueuing } = useMutation<EnqueueResponse>(
    enqueuePath,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [cachePath] });
      },
    }
  );

  const summary = cached?.data ?? null;
  const pendingAnalysisCount = cached?.pendingAnalysisCount ?? 0;
  const hasOngoingAnalysis = pendingAnalysisCount > 0 || isEnqueuing;

  if (isLoading) {
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">LLM Failure Analysis</h3>
            <p className="text-sm text-muted-foreground">
              Test health analysis based on the latest 10 runs
            </p>
          </div>
          {hasOngoingAnalysis ? (
            ongoingButton
          ) : (
            <Button variant="outline" size="sm" onClick={() => enqueueAnalysis({})}>
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
        {hasOngoingAnalysis && !summary && (
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
        {summary && (
          <div className="space-y-3">
            <MarkdownRenderer content={summary.summary} />
            {(summary.model || summary.updatedAt || summary.reportCount) && (
              <div className="flex items-center gap-2 pt-3 border-t text-xs text-muted-foreground flex-wrap">
                {summary.model && <Badge variant="outline">{summary.model}</Badge>}
                {summary.reportCount &&
                  summary.reportCount > 0 &&
                  summary.firstReportAt &&
                  summary.lastReportAt && (
                    <span>
                      Generated for {summary.reportCount}{' '}
                      {summary.reportCount === 1 ? 'report' : 'reports'} between{' '}
                      {new Date(summary.firstReportAt).toLocaleDateString()} and{' '}
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
        {!hasOngoingAnalysis && !summary && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Click "Generate Analysis" to get an LLM-powered health analysis of the latest runs
          </div>
        )}
      </CardContent>
    </Card>
  );
}
