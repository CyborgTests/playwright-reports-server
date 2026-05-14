import type { CompareReportRef } from '@playwright-reports/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import FormattedDate from '@/components/date-format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  label: string;
  report: CompareReportRef;
  footer?: ReactNode;
}

const passRate = (stats: CompareReportRef['stats']) => {
  if (!stats || !stats.total) return null;
  const passed = stats.expected ?? 0;
  const denom = stats.total - (stats.skipped ?? 0);
  if (denom <= 0) return null;
  return Math.round((passed / denom) * 1000) / 10;
};

const passRateTone = (rate: number) => {
  if (rate >= 95) return 'success' as const;
  if (rate >= 70) return 'warning' as const;
  return 'failure' as const;
};

export function ReportSummaryCard({ label, report, footer }: Props) {
  const rate = passRate(report.stats);
  return (
    <Card className="h-full">
      <CardContent className="p-4 space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <Link
          to={`/report/${report.reportID}`}
          className="block font-semibold text-base hover:underline"
        >
          {report.displayNumber ? `#${report.displayNumber} ` : ''}
          {report.title ?? report.reportID.slice(0, 8)}
        </Link>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>{report.project}</span>
          <span>·</span>
          <FormattedDate date={report.createdAt} />
        </div>
        {report.stats && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {rate !== null && <Badge variant={passRateTone(rate)}>{rate.toFixed(1)}% pass</Badge>}
            <Badge variant="secondary">{report.stats.total} tests</Badge>
            {(report.stats.unexpected ?? 0) > 0 && (
              <Badge variant="failure">{report.stats.unexpected} failed</Badge>
            )}
            {(report.stats.flaky ?? 0) > 0 && (
              <Badge variant="flaky">{report.stats.flaky} flaky</Badge>
            )}
            {(report.stats.skipped ?? 0) > 0 && (
              <Badge variant="skipped">{report.stats.skipped} skipped</Badge>
            )}
          </div>
        )}
        {footer && <div className="pt-2">{footer}</div>}
      </CardContent>
    </Card>
  );
}
