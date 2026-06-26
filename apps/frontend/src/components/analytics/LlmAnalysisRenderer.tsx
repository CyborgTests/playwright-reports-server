import type { ProjectAnalysisStructured, ProjectAnalysisVerdict } from '@playwright-reports/shared';
import {
  Activity,
  AlertTriangle,
  ListChecks,
  type LucideIcon,
  Stethoscope,
  TrendingUp,
} from 'lucide-react';
import { AnalysisSections } from '@/components/analysis-sections';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge, type BadgeProps } from '@/components/ui/badge';

interface LlmAnalysisRendererProps {
  analysis: ProjectAnalysisStructured;
  /** Project the verdict was generated for. Forwarded to MarkdownRenderer so
   *  inline `pwrs:test/ID` links resolve to `/test/ID?project=…` correctly
   *  when the model didn't include a project in the URL. */
  fallbackProject?: string;
}

const verdictMeta: Record<
  ProjectAnalysisVerdict,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  healthy: { label: 'Healthy', variant: 'success' },
  stabilizing: { label: 'Stabilizing', variant: 'info' },
  degrading: { label: 'Degrading', variant: 'warning' },
  failing: { label: 'Failing', variant: 'danger' },
};

const sectionIcon = (heading: string): LucideIcon => {
  const h = heading.toLowerCase();
  if (h.includes('recommend')) return ListChecks;
  if (h.includes('risk')) return AlertTriangle;
  if (h.includes('trend')) return TrendingUp;
  if (h.includes('health')) return Stethoscope;
  return Activity;
};

export function VerdictBadge({ verdict }: Readonly<{ verdict: ProjectAnalysisVerdict }>) {
  const meta = verdictMeta[verdict];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function LlmAnalysisRenderer({
  analysis,
  fallbackProject,
}: Readonly<LlmAnalysisRendererProps>) {
  const { sections, summary } = analysis;
  return (
    <AnalysisSections
      sections={sections}
      iconFor={sectionIcon}
      fallbackProject={fallbackProject}
      summary={
        summary ? (
          <MarkdownRenderer
            content={summary}
            fallbackProject={fallbackProject}
            className="text-base text-foreground"
          />
        ) : null
      }
    />
  );
}
