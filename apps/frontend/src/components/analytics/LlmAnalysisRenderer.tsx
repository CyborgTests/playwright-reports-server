'use client';

import type { ProjectAnalysisStructured, ProjectAnalysisVerdict } from '@playwright-reports/shared';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileCode,
  ListChecks,
  Stethoscope,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge, type BadgeProps } from '@/components/ui/badge';

interface LlmAnalysisRendererProps {
  analysis: ProjectAnalysisStructured;
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

interface CodeRefsProps {
  refs: NonNullable<ProjectAnalysisStructured['sections'][number]['codeRefs']>;
  latestReportId?: string;
}

function CodeRefs({ refs, latestReportId }: Readonly<CodeRefsProps>) {
  if (refs.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {refs.map((ref) => {
        const targetReport = ref.reportId ?? latestReportId;
        const label = ref.line ? `${ref.file}:${ref.line}` : ref.file;
        const key = `${targetReport ?? 'no-report'}::${ref.file}::${ref.line ?? ''}`;
        const inner = (
          <>
            <FileCode className="h-3 w-3" />
            {label}
          </>
        );
        const className =
          'inline-flex items-center gap-1 rounded border bg-muted/30 px-2 py-0.5 text-xs font-mono';
        return targetReport ? (
          <RouterLink
            key={key}
            to={`/report/${targetReport}`}
            className={`${className} text-primary hover:underline`}
          >
            {inner}
          </RouterLink>
        ) : (
          <span key={key} className={`${className} text-muted-foreground`}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

export function LlmAnalysisRenderer({ analysis }: Readonly<LlmAnalysisRendererProps>) {
  const { sections, summary, latestReportId } = analysis;
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
      {summary && <p className="text-base leading-relaxed text-foreground">{summary}</p>}

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
                <MarkdownRenderer content={section.body} />
                {section.codeRefs && (
                  <CodeRefs refs={section.codeRefs} latestReportId={latestReportId} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
