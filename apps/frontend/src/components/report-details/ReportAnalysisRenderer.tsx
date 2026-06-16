import type { ReportAnalysisStructured, ReportAnalysisVerdict } from '@playwright-reports/shared';
import { REPORT_VERDICT_DESCRIPTIONS } from '@playwright-reports/shared';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  ListChecks,
} from 'lucide-react';
import { useState } from 'react';
import { MarkdownRenderer } from '@/components/markdown-renderer';
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

const sectionIcon = (heading: string) => {
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
  // First section is always open; rest are collapsed by default.
  const [openExtras, setOpenExtras] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setOpenExtras((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {summary && <p className="text-base leading-relaxed text-foreground">{summary}</p>}

      {sections.map((section, index) => {
        const Icon = sectionIcon(section.heading);
        const isFirst = index === 0;
        const isOpen = isFirst || openExtras.has(index);
        const impact = section.impact ? impactMeta[section.impact] : null;
        return (
          <div
            key={`${index}-${section.heading}`}
            className="border-t pt-3 first:border-t-0 first:pt-0"
          >
            <button
              type="button"
              onClick={() => !isFirst && toggle(index)}
              disabled={isFirst}
              className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"
            >
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {section.heading}
                {impact && (
                  <Badge variant={impact.variant} className="ml-1 text-[10px]">
                    {impact.label}
                  </Badge>
                )}
              </h3>
              {!isFirst &&
                (isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ))}
            </button>
            {isOpen && (
              <div className="mt-2">
                <MarkdownRenderer content={section.body} fallbackProject={fallbackProject} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
