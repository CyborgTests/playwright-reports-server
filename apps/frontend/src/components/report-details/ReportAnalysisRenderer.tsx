'use client';

import type { ReportAnalysisStructured, ReportAnalysisVerdict } from '@playwright-reports/shared';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileCode,
  FlaskConical,
  ListChecks,
} from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge, type BadgeProps } from '@/components/ui/badge';

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
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

interface CodeRefsProps {
  refs: NonNullable<ReportAnalysisStructured['sections'][number]['codeRefs']>;
  reportId?: string;
  fallbackProject?: string;
}

function CodeRefs({ refs, reportId, fallbackProject }: Readonly<CodeRefsProps>) {
  if (refs.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {refs.map((ref, i) => {
        const className =
          'inline-flex items-center gap-1 rounded border bg-muted/30 px-2 py-0.5 text-xs font-mono';
        const inner = (
          <>
            <FileCode className="h-3 w-3" />
            {ref.label}
            {ref.line ? `:${ref.line}` : ''}
          </>
        );

        // 'test' refs need both testId and fileId to route to /test/:fileId/:testId.
        // The test detail page scopes its lookup by `?project=…` since
        // testId+fileId aren't unique across projects, so we always append it
        // when it's available (the worker injects it for report-summary refs).
        if (ref.kind === 'test' && ref.testId && ref.fileId) {
          const project = ref.project ?? fallbackProject;
          const query = project ? `?project=${encodeURIComponent(project)}` : '';
          return (
            <RouterLink
              key={`test-${ref.testId}-${i}`}
              to={`/test/${ref.fileId}/${ref.testId}${query}`}
              className={`${className} text-primary hover:underline`}
            >
              {inner}
            </RouterLink>
          );
        }

        // 'file' refs link back into the current report; the served Playwright
        // viewer handles in-report navigation. If reportId is missing, render as
        // a non-link chip (still useful as a visual citation).
        if (ref.kind === 'file' && reportId) {
          return (
            <RouterLink
              key={`file-${ref.filePath}-${i}`}
              to={`/report/${reportId}`}
              className={`${className} text-primary hover:underline`}
              title={ref.filePath}
            >
              {inner}
            </RouterLink>
          );
        }

        return (
          <span key={`ref-${i}`} className={`${className} text-muted-foreground`}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

export function ReportAnalysisRenderer({
  analysis,
  fallbackProject,
}: Readonly<ReportAnalysisRendererProps>) {
  const { sections, summary, reportId } = analysis;
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
                {section.codeRefs && (
                  <CodeRefs
                    refs={section.codeRefs}
                    reportId={reportId}
                    fallbackProject={fallbackProject}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
