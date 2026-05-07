'use client';

import type { DateRange } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';
import { withBase } from '@/lib/url';

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
}

interface FailureAnalysisSummaryProps {
  project?: string;
  totalFailures?: number;
  dateRange?: DateRange;
}

export function FailureAnalysisSummary({
  project,
  totalFailures,
  dateRange,
}: Readonly<FailureAnalysisSummaryProps>) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [firstReportAt, setFirstReportAt] = useState<string | null>(null);
  const [lastReportAt, setLastReportAt] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Hydrate from the persisted cache so a refresh shows the same summary until a new
  // report for this project arrives. Cache key is project only — the date filter just
  // narrows the input pool for regeneration; relative ranges shouldn't blow the cache.
  const cacheParams = new URLSearchParams();
  if (project && project !== defaultProjectName) cacheParams.append('project', project);
  const cachePath = `/api/analytics/project-summary?${cacheParams.toString()}`;
  const { data: cached } = useQuery<CachedSummaryResponse>(cachePath, {
    dependencies: [project],
    retry: false,
  });

  useEffect(() => {
    if (cached?.data && !isStreaming) {
      setSummary(cached.data.summary);
      setModel(cached.data.model);
      setUpdatedAt(cached.data.updatedAt);
      setReportCount(cached.data.reportCount);
      setFirstReportAt(cached.data.firstReportAt);
      setLastReportAt(cached.data.lastReportAt);
    } else if (cached?.data === null && !isStreaming) {
      // Cache was invalidated (e.g. new report arrived) — clear stale UI state.
      setSummary(null);
      setModel(null);
      setUpdatedAt(null);
      setReportCount(null);
      setFirstReportAt(null);
      setLastReportAt(null);
    }
  }, [cached, isStreaming]);

  const handleGenerate = async () => {
    setIsStreaming(true);

    try {
      const jwtToken = localStorage.getItem('jwtToken');
      const headers: HeadersInit = {};
      if (jwtToken) headers.Authorization = `Bearer ${jwtToken}`;

      const params = new URLSearchParams();
      if (project) params.append('project', project);
      if (dateRange?.from) params.append('from', dateRange.from);
      if (dateRange?.to) params.append('to', dateRange.to);

      const response = await fetch(
        withBase(`/api/analytics/failure-categories/llm?${params.toString()}`),
        { method: 'POST', headers }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'token' && data.content) {
              content += data.content;
              setSummary(content);
            } else if (data.type === 'done') {
              setModel(data.model || null);
            } else if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (parseError) {
            if (parseError instanceof SyntaxError) continue;
            throw parseError;
          }
        }
      }

      // Mark the persisted summary as just-updated for the timestamp in the footer.
      setUpdatedAt(new Date().toISOString());

      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey.some(
            (k) =>
              typeof k === 'string' &&
              (k.includes('failure-categories') || k.includes('project-summary'))
          ),
      });
    } catch (error) {
      toast.error(
        `LLM analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setSummary(null);
    } finally {
      setIsStreaming(false);
    }
  };

  // No failures — show success message
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
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isStreaming}>
            {isStreaming ? (
              <>
                <Spinner size="sm" /> Analyzing...
              </>
            ) : summary ? (
              'Re-generate'
            ) : (
              'Generate Analysis'
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isStreaming && !summary && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Spinner size="sm" />
            <span className="text-muted-foreground">LLM is analyzing latest runs...</span>
          </div>
        )}
        {summary && (
          <div className="space-y-3">
            <MarkdownRenderer content={summary} />
            {(model || updatedAt || reportCount) && (
              <div className="flex items-center gap-2 pt-3 border-t text-xs text-muted-foreground flex-wrap">
                {model && <Badge variant="outline">{model}</Badge>}
                {reportCount && reportCount > 0 && firstReportAt && lastReportAt && (
                  <span>
                    Generated for {reportCount} {reportCount === 1 ? 'report' : 'reports'} between{' '}
                    {new Date(firstReportAt).toLocaleDateString()} and{' '}
                    {new Date(lastReportAt).toLocaleDateString()}
                  </span>
                )}
                {updatedAt && (
                  <span className="ml-auto">Generated {new Date(updatedAt).toLocaleString()}</span>
                )}
              </div>
            )}
          </div>
        )}
        {!isStreaming && !summary && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Click "Generate Analysis" to get an LLM-powered health analysis of the latest runs
          </div>
        )}
      </CardContent>
    </Card>
  );
}
