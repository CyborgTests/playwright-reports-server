import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import useMutation from '@/hooks/useMutation';
import { SERVER_CONFIG_KEY, useServerConfig } from '@/hooks/useServerConfig';

type ToggleKey =
  | 'autoAnalyzeNewReports'
  | 'autoProjectSummaryOnReportComplete'
  | 'analyzeGreenWindows';

const TOGGLES: { key: ToggleKey; field: string; title: string; description: string }[] = [
  {
    key: 'autoAnalyzeNewReports',
    field: 'llmAutoAnalyzeNewReports',
    title: 'Auto-analyze new reports',
    description:
      'When enabled, every failed test in a newly ingested report is queued for LLM analysis automatically.',
  },
  {
    key: 'autoProjectSummaryOnReportComplete',
    field: 'llmAutoProjectSummaryOnReportComplete',
    title: 'Auto-generate project summary',
    description:
      "When enabled, completing a report failure analysis automatically queues a project-level summary for that report's project.",
  },
  {
    key: 'analyzeGreenWindows',
    field: 'llmAnalyzeGreenWindows',
    title: 'Analyze all-green windows',
    description:
      'When enabled, runs LLM even when no failures were observed - shows duration diff, near-flakes, quarantine churn, and suite size.',
  },
];

export default function LLMAutomationSection() {
  const queryClient = useQueryClient();
  const { data: config } = useServerConfig();
  const [values, setValues] = useState<Record<ToggleKey, boolean>>({
    autoAnalyzeNewReports: false,
    autoProjectSummaryOnReportComplete: false,
    analyzeGreenWindows: false,
  });

  useEffect(() => {
    if (!config?.llm) return;
    setValues({
      autoAnalyzeNewReports: !!config.llm.autoAnalyzeNewReports,
      autoProjectSummaryOnReportComplete: !!config.llm.autoProjectSummaryOnReportComplete,
      analyzeGreenWindows: !!config.llm.analyzeGreenWindows,
    });
  }, [config]);

  const mutation = useMutation('/api/config', {
    method: 'PATCH',
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [SERVER_CONFIG_KEY] }),
  });

  const toggle = (key: ToggleKey, field: string, next: boolean) => {
    setValues((prev) => ({ ...prev, [key]: next })); // optimistic
    const fd = new FormData();
    fd.append(field, String(next));
    mutation.mutate(
      { body: fd },
      { onError: () => setValues((prev) => ({ ...prev, [key]: !next })) }
    );
  };

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">Automation</h3>
      <div className="space-y-4">
        {TOGGLES.map(({ key, field, title, description }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-sm font-medium">{title}</h4>
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            </div>
            <Switch checked={values[key]} onCheckedChange={(c) => toggle(key, field, c)} />
          </div>
        ))}
      </div>
    </section>
  );
}
