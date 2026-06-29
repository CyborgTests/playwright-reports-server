import { CAPABILITIES } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useHasCapability } from '@/hooks/useHasCapability';
import { useLlmModels } from '@/hooks/useLlmModels';
import useMutation from '@/hooks/useMutation';
import { SERVER_CONFIG_KEY, useServerConfig } from '@/hooks/useServerConfig';
import LLMAutomationSection from './LLMAutomationSection';
import LLMModelsConfiguration from './LLMModelsConfiguration';
import LLMPromptsSection from './LLMPromptsSection';
import LLMRoutingConfiguration from './LLMRoutingConfiguration';

export default function LLMConfiguration() {
  const queryClient = useQueryClient();
  const { data: config } = useServerConfig();
  const { data: models } = useLlmModels();
  const canConfigLlm = useHasCapability()(CAPABILITIES.configLlm);
  const hasPrimary = (models ?? []).some((m) => m.isPrimary);
  const [featureEnabled, setFeatureEnabled] = useState(false);

  useEffect(() => {
    if (config?.llm) setFeatureEnabled(config.llm.enabled !== false);
  }, [config]);

  const mutation = useMutation('/api/config', {
    method: 'PATCH',
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [SERVER_CONFIG_KEY] }),
  });

  const toggleFeature = (next: boolean) => {
    if (next && !hasPrimary) return;
    setFeatureEnabled(next);
    const formData = new FormData();
    formData.append('llmFeatureEnabled', String(next));
    mutation.mutate({ body: formData }, { onError: () => setFeatureEnabled(!next) });
  };

  return (
    <Card id="llm" className="mb-6 scroll-mt-20 p-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">LLM Configuration</h2>
        </div>
        {canConfigLlm && (
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
        )}
      </CardHeader>
      <CardContent className="divide-y divide-border [&>section]:py-6 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
        <LLMModelsConfiguration featureEnabled={featureEnabled} canEdit={canConfigLlm} />
        {canConfigLlm && (
          <>
            <LLMRoutingConfiguration featureEnabled={featureEnabled} />
            <LLMAutomationSection />
            <LLMPromptsSection />
          </>
        )}
      </CardContent>
    </Card>
  );
}
