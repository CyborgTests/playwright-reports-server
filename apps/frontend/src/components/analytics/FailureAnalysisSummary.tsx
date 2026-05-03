'use client';

import type { DateRange } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { withBase } from '@/lib/url';

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
  const queryClient = useQueryClient();

  const handleGenerate = async () => {
    setIsStreaming(true);
    setSummary('');
    setModel(null);

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

      queryClient.invalidateQueries({ predicate: (q) => q.queryKey.some((k) => typeof k === 'string' && k.includes('failure-categories')) });
    } catch (error) {
      toast.error(`LLM analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={isStreaming}
          >
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
            {model && (
              <div className="flex items-center gap-2 pt-3 border-t text-xs text-muted-foreground">
                <Badge variant="outline">{model}</Badge>
                <span>{new Date().toLocaleString()}</span>
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
