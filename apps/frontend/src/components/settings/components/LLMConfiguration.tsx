import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useLlmModels } from '@/hooks/useLlmModels';
import { apiFetch, errMessage } from '@/lib/api';
import LLMAutomationSection from './LLMAutomationSection';
import LLMModelsConfiguration from './LLMModelsConfiguration';
import LLMPromptsSection from './LLMPromptsSection';
import LLMRoutingConfiguration from './LLMRoutingConfiguration';

export default function LLMConfiguration() {
  const session = useAuth();
  const { data: models } = useLlmModels();
  const hasPrimary = (models ?? []).some((m) => m.isPrimary);
  const [featureEnabled, setFeatureEnabled] = useState(false);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    apiFetch<{ llm?: { enabled?: boolean } }>('/api/config')
      .then((cfg) => setFeatureEnabled(cfg.llm?.enabled !== false))
      .catch(() => {
        // non-fatal: stays disabled until config loads
      });
  }, [session.status]);

  const toggleFeature = useCallback(
    async (next: boolean) => {
      if (next && !hasPrimary) return; // guarded by the disabled checkbox; defensive
      setFeatureEnabled(next);
      try {
        const fd = new FormData();
        fd.append('llmFeatureEnabled', String(next));
        await apiFetch('/api/config', { method: 'PATCH', body: fd });
        toast.success(next ? 'LLM features enabled' : 'LLM features disabled');
      } catch (err) {
        setFeatureEnabled(!next);
        toast.error(`Failed to update LLM setting: ${errMessage(err)}`);
      }
    },
    [hasPrimary]
  );

  return (
    <Card id="llm" className="mb-6 scroll-mt-20 p-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-xl font-semibold">LLM Configuration</h2>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={featureEnabled}
              disabled={!hasPrimary}
              onCheckedChange={(c) => toggleFeature(c === true)}
            />
            Enable LLM features
          </Label>
          {!hasPrimary && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Add a model below and set it as primary to enable.
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-border [&>section]:py-6 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
        <LLMModelsConfiguration featureEnabled={featureEnabled} />
        <LLMRoutingConfiguration featureEnabled={featureEnabled} />
        <LLMAutomationSection />
        <LLMPromptsSection />
      </CardContent>
    </Card>
  );
}
