import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch, errMessage } from '@/lib/api';

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
      'When enabled, completing a report\'s failure analysis automatically queues a project-level summary for that project and for "all" projects.',
  },
  {
    key: 'analyzeGreenWindows',
    field: 'llmAnalyzeGreenWindows',
    title: 'Analyze all-green windows',
    description:
      'When enabled, "Generate Analysis" runs the LLM even when no failures were observed - surfaces duration creep, near-flakes, quarantine churn, and suite shrinkage. Off by default to keep LLM spend predictable.',
  },
];

export default function LLMAutomationSection() {
  const session = useAuth();
  const [values, setValues] = useState<Record<ToggleKey, boolean>>({
    autoAnalyzeNewReports: false,
    autoProjectSummaryOnReportComplete: false,
    analyzeGreenWindows: false,
  });

  const load = useCallback(async () => {
    try {
      const cfg = await apiFetch<{ llm?: Partial<Record<ToggleKey, boolean>> }>('/api/config');
      setValues({
        autoAnalyzeNewReports: !!cfg.llm?.autoAnalyzeNewReports,
        autoProjectSummaryOnReportComplete: !!cfg.llm?.autoProjectSummaryOnReportComplete,
        analyzeGreenWindows: !!cfg.llm?.analyzeGreenWindows,
      });
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    load();
  }, [session.status, load]);

  const toggle = async (key: ToggleKey, field: string, next: boolean) => {
    setValues((prev) => ({ ...prev, [key]: next })); // optimistic
    try {
      const fd = new FormData();
      fd.append(field, String(next));
      await apiFetch('/api/config', { method: 'PATCH', body: fd });
    } catch (err) {
      setValues((prev) => ({ ...prev, [key]: !next }));
      toast.error(`Failed to update setting: ${errMessage(err)}`);
    }
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
