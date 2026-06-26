import type { ReportAnalysisStructured, ReportAnalysisVerdict } from '@playwright-reports/shared';
import { REPORT_VERDICT_DESCRIPTIONS } from '@playwright-reports/shared';
import { Activity, AlertTriangle, FlaskConical, ListChecks, type LucideIcon } from 'lucide-react';
import { AnalysisSections } from '@/components/analysis-sections';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ReportAnalysisRendererProps {
  analysis: ReportAnalysisStructured;
  /** Fallback project for codeRefs that don't carry one. Used by cached
   *  summaries written before the worker started injecting `project` on
   *  every ref. Newer payloads carry it explicitly. */
  fallbackProject?: string;
}

const verdictMeta: Record<
  ReportAnalysisVerdict,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  isolated: { label: 'Isolated', variant: 'secondary' },
  clustered: { label: 'Clustered', variant: 'warning' },
  widespread: { label: 'Widespread', variant: 'danger' },
  systemic: { label: 'Systemic', variant: 'destructive' },
};

const impactMeta: Record<
  NonNullable<ReportAnalysisStructured['sections'][number]['impact']>,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  high: { label: 'high impact', variant: 'danger' },
  medium: { label: 'medium impact', variant: 'warning' },
  low: { label: 'low impact', variant: 'secondary' },
};

const sectionIcon = (heading: string): LucideIcon => {
  const h = heading.toLowerCase();
  if (h.includes('recommend')) return ListChecks;
  if (h.includes('risk')) return AlertTriangle;
  if (h.includes('pattern')) return FlaskConical;
  return Activity;
};

export function ReportVerdictBadge({ verdict }: Readonly<{ verdict: ReportAnalysisVerdict }>) {
  const meta = verdictMeta[verdict];
  const description = REPORT_VERDICT_DESCRIPTIONS[verdict];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={meta.variant} className="cursor-help">
            {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ReportAnalysisRenderer({
  analysis,
  fallbackProject,
}: Readonly<ReportAnalysisRendererProps>) {
  const { sections, summary } = analysis;
  return (
    <AnalysisSections
      sections={sections}
      iconFor={sectionIcon}
      fallbackProject={fallbackProject}
      summary={
        summary ? <p className="text-base leading-relaxed text-foreground">{summary}</p> : null
      }
      headingExtra={(section) => {
        const impact = section.impact ? impactMeta[section.impact] : null;
        return impact ? (
          <Badge variant={impact.variant} className="ml-1 text-[10px]">
            {impact.label}
          </Badge>
        ) : null;
      }}
    />
  );
}
