import type { LLMConfig } from '@playwright-reports/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/auth';

export type LlmTestResult = { ok: true; models?: string[] } | { ok: false; error: string } | null;

export function useLlmConnectionTest() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult>(null);

  const test = async (source: LLMConfig | undefined, isEditing: boolean) => {
    setTesting(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (source?.provider) body.provider = source.provider;
      if (isEditing) {
        body.baseUrl = source?.baseUrl ?? '';
        body.model = source?.model ?? '';
        const apiKey = source?.apiKey ?? '';
        if (!/^\*+$/.test(apiKey)) body.apiKey = apiKey;
      } else {
        if (source?.baseUrl) body.baseUrl = source.baseUrl;
        if (source?.apiKey && !/^\*+$/.test(source.apiKey)) body.apiKey = source.apiKey;
        if (source?.model) body.model = source.model;
      }

      const res = await fetch('/api/llm/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data?.success) {
        setTestResult({ ok: true, models: data.models });
        toast.success('LLM connection successful');
      } else {
        const error = data?.error || 'Connection test failed';
        setTestResult({ ok: false, error });
        toast.error(error);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Connection test failed';
      setTestResult({ ok: false, error });
      toast.error(error);
    } finally {
      setTesting(false);
    }
  };

  return { testing, testResult, test, clearResult: () => setTestResult(null) };
}

export function useLlmAvailableModels() {
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/llm/available-models?refresh=1', { headers: authHeaders() });
      const data = await res.json();
      if (data?.success && Array.isArray(data.models)) {
        setAvailableModels(data.models);
        if (data.models.length === 0) {
          toast.info('Provider returned no models');
        }
      } else {
        toast.error(data?.error || 'Failed to fetch models');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setRefreshing(false);
    }
  };

  return { availableModels, refreshing, refresh };
}
