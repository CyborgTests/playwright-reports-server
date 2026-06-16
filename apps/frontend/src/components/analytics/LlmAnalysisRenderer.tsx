import type { ProjectAnalysisStructured, ProjectAnalysisVerdict } from '@playwright-reports/shared';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Stethoscope,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
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

const sectionIcon = (heading: string) => {
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
  // First section is always open; rest are collapsed by default. Index 0 is
  // never in this Set; the entries here are explicitly toggled-open sections.
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
      {summary && (
        <MarkdownRenderer
          content={summary}
          fallbackProject={fallbackProject}
          className="text-base text-foreground"
        />
      )}

      {sections.map((section, index) => {
        const Icon = sectionIcon(section.heading);
        const isFirst = index === 0;
        const isOpen = isFirst || openExtras.has(index);
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
