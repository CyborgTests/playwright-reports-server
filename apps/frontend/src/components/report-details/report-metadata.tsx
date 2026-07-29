import type { ReportHistory } from '@playwright-reports/shared';
import { Link } from 'react-router-dom';
import { extractReportTags } from '@/lib/report-tags';
import { withBase } from '@/lib/url';

interface ReportMetadataProps {
  report: ReportHistory;
}

/** The custom fields the run was uploaded with (branch, tag, testRun, ...),
 *  each linking to the report list filtered by that exact tag. */
export default function ReportMetadata({ report }: Readonly<ReportMetadataProps>) {
  const tags = Object.entries(extractReportTags(report)).sort(([a], [b]) => a.localeCompare(b));

  if (tags.length === 0) return null;

  return (
    <div className="mt-2 mb-6 flex flex-wrap items-center gap-2">
      {tags.map(([key, value]) => (
        <Link
          key={key}
          to={withBase(`/reports?tags=${encodeURIComponent(`${key}:${value}`)}`)}
          title={`Show reports with ${key}: ${value}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs hover:bg-muted"
        >
          <span className="text-muted-foreground">{key}</span>
          <span className="max-w-[24rem] truncate font-medium">{value}</span>
        </Link>
      ))}
    </div>
  );
}
