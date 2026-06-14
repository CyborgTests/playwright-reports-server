import { Info } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { withBase } from '@/lib/url';

export function formatDaysOpen(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h open`;
  return `${Math.round(days * 10) / 10}d open`;
}

export function servedReportUrl(reportId: string, testId: string): string {
  return `${withBase(`/api/serve/${reportId}/index.html`)}#?testId=${testId}`;
}

export function outcomeBadge(outcome: string) {
  switch (outcome) {
    case 'expected':
    case 'passed':
      return <Badge variant="success">Passed</Badge>;
    case 'flaky':
      return <Badge variant="warning">Flaky</Badge>;
    case 'unexpected':
    case 'failed':
      return <Badge variant="danger">Failed</Badge>;
    case 'skipped':
      return <Badge variant="skipped">Skipped</Badge>;
    default:
      return <Badge variant="secondary">{outcome}</Badge>;
  }
}

const OUTCOME_COLOR: Record<string, string> = {
  expected: 'hsl(var(--success))',
  passed: 'hsl(var(--success))',
  flaky: 'hsl(var(--warning))',
  unexpected: 'hsl(var(--danger))',
  failed: 'hsl(var(--danger))',
  skipped: 'hsl(var(--skipped))',
};

export function dotColor(outcome: string): string {
  return OUTCOME_COLOR[outcome] ?? 'hsl(var(--muted-foreground))';
}

export function StatTile({
  label,
  value,
  hint,
  info,
}: Readonly<{ label: string; value: string; hint?: string; info?: string }>) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          {info && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info
                    className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help"
                    aria-label={`What is ${label}?`}
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{info}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-2xl font-bold mt-1 truncate">{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function CollapsibleSection({
  title,
  subtitle,
  meta,
  defaultOpen = true,
  children,
}: Readonly<{
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <Card>
      <Accordion type="single" collapsible defaultValue={defaultOpen ? 'open' : undefined}>
        <AccordionItem value="open" className="border-b-0">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex flex-1 items-center justify-between gap-3 pr-2 min-w-0">
              <div className="text-left min-w-0">
                <h3 className="text-lg font-semibold leading-tight">{title}</h3>
                {subtitle && (
                  <p className="text-sm text-muted-foreground mt-1 font-normal">{subtitle}</p>
                )}
              </div>
              {meta && (
                <span className="text-sm text-muted-foreground font-normal shrink-0">{meta}</span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="px-6 pt-2">{children}</div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
