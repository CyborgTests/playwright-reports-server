import {
  FAILURE_CATEGORY_DESCRIPTIONS,
  type FailureCategory,
  type ReportFailureSummary as FailureSummary,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Brain, RefreshCw } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfig } from '@/hooks/useConfig';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { ReportAnalysisRenderer, ReportVerdictBadge } from './ReportAnalysisRenderer';

interface ReportFailureSummaryProps {
  reportId: string;
}

interface FailureSummaryResponse {
  success: boolean;
  data?: FailureSummary;
  hasFailures?: boolean;
  pendingAnalysisCount?: number;
  error?: string;
}

interface AnalyzeResponse {
  success: boolean;
  queued: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  timeout: 'bg-amber-100 text-amber-800',
  assertion_error: 'bg-red-100 text-red-800',
  network_error: 'bg-blue-100 text-blue-800',
  element_not_found: 'bg-purple-100 text-purple-800',
  navigation_error: 'bg-cyan-100 text-cyan-800',
  javascript_error: 'bg-orange-100 text-orange-800',
  permission_error: 'bg-pink-100 text-pink-800',
  setup_teardown: 'bg-gray-100 text-gray-800',
  browser_crash: 'bg-red-100 text-red-800',
  api_error: 'bg-blue-100 text-blue-800',
  snapshot_mismatch: 'bg-purple-100 text-purple-800',
  unknown: 'bg-slate-100 text-slate-800',
};

function getCategoryColor(category: string): string {
  const key = category.toLowerCase();
  return CATEGORY_COLORS[key] ?? 'bg-slate-100 text-slate-800';
}

export default function ReportFailureSummary({ reportId }: Readonly<ReportFailureSummaryProps>) {
  const { data: config } = useConfig();
  const queryClient = useQueryClient();

  const queryPath = `/api/report/${reportId}/failure-summary`;

  const {
    data: summaryResponse,
    isLoading,
    error,
  } = useQuery<FailureSummaryResponse>(queryPath, {
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as FailureSummaryResponse | undefined;
      return (data?.pendingAnalysisCount ?? 0) > 0 ? 10000 : false;
    },
  });

  const { mutate: triggerAnalysis, isPending: isAnalyzing } = useMutation<AnalyzeResponse>(
    `/api/report/${reportId}/analyze`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [queryPath] });
      },
    }
  );

  const llmConfigured = !!config?.llm?.baseUrl;

  if (isLoading) {
    return null;
  }

  const summary = summaryResponse?.data;
  const hasFailures = summaryResponse?.hasFailures ?? false;
  const pendingAnalysisCount = summaryResponse?.pendingAnalysisCount ?? 0;
  const hasOngoingAnalysis = pendingAnalysisCount > 0 || isAnalyzing;

  if (!summary && !llmConfigured) {
    return null;
  }

  if ((!summary || error) && !hasFailures) {
    return null;
  }

  // Show the Summarize button when failures exist but no summary has been generated yet.
  if (!summary || error) {
    return (
      <Card className="mb-4">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Brain className="h-4 w-4" />
            <span>LLM failure analysis available</span>
          </div>
          {hasOngoingAnalysis ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="sm" variant="outline" disabled>
                      <Spinner size="sm" className="mr-1" />
                      Analysis ongoing{pendingAnalysisCount > 0 ? ` (${pendingAnalysisCount})` : ''}
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
          ) : (
            <Button size="sm" variant="outline" onClick={() => triggerAnalysis({})}>
              <Brain className="h-4 w-4 mr-1" />
              Summarize Failures
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const categoryEntries = Object.entries(summary.categories);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Failure Summary
            <Badge variant="destructive" className="ml-1">
              {summary.totalFailures} {summary.totalFailures === 1 ? 'failure' : 'failures'}
            </Badge>
            {summary.llmSummaryStructured && (
              <ReportVerdictBadge verdict={summary.llmSummaryStructured.verdict} />
            )}
          </CardTitle>
          {hasOngoingAnalysis ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="sm" variant="ghost" disabled>
                      <Spinner size="sm" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Analysis ongoing{pendingAnalysisCount > 0 ? ` (${pendingAnalysisCount})` : ''} -
                  check the{' '}
                  <RouterLink to="/llm-queue" className="underline">
                    LLM queue
                  </RouterLink>
                  .
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            llmConfigured && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => triggerAnalysis({})}
                title="Re-analyze failures"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Category breakdown */}
        {categoryEntries.length > 0 && (
          <TooltipProvider delayDuration={150}>
            <div className="flex flex-wrap gap-2">
              {categoryEntries.map(([category, count]) => {
                const description =
                  FAILURE_CATEGORY_DESCRIPTIONS[category as FailureCategory] ?? null;
                const chipClassName = `inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-semibold cursor-help ${getCategoryColor(category)}`;
                return description ? (
                  <Tooltip key={category}>
                    <TooltipTrigger asChild>
                      <span className={chipClassName}>
                        {category}
                        <span className="font-bold">{count}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">{description}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={category} className={chipClassName}>
                    {category}
                    <span className="font-bold">{count}</span>
                  </span>
                );
              })}
            </div>
          </TooltipProvider>
        )}

        {/* LLM Summary */}
        {(summary.llmSummaryStructured || summary.llmSummary) && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">LLM Summary</p>
            {summary.llmSummaryStructured ? (
              <ReportAnalysisRenderer
                analysis={summary.llmSummaryStructured}
                fallbackProject={summary.project}
              />
            ) : (
              // Fallback: structured parse failed (rare — empty or unparseable
              // LLM response). Render the raw markdown so the user still sees
              // whatever the model produced.
              <div className="prose prose-sm max-w-none">
                <MarkdownRenderer content={summary.llmSummary ?? ''} />
              </div>
            )}
            {(summary.llmModel || summary.updatedAt) && (
              <div className="flex items-center gap-2 pt-3 mt-3 border-t text-xs text-muted-foreground flex-wrap">
                {summary.llmModel && <Badge variant="outline">{summary.llmModel}</Badge>}
                {summary.updatedAt && (
                  <span className="ml-auto">
                    Generated {new Date(summary.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
