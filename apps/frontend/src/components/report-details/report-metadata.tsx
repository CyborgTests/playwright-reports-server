import type { ReportHistory } from '@playwright-reports/shared';
import { ENV_UNKNOWN_FILTER } from '@playwright-reports/shared';
import { Link } from 'react-router-dom';
import { getEnvironmentLabel } from '@/lib/environment';
import { extractReportTags } from '@/lib/report-tags';
import { withBase } from '@/lib/url';

interface ReportMetadataProps {
  report: ReportHistory;
}

function metadataFilterHref(key: string, value: string): string {
  if (key === 'environment') {
    const normalized = getEnvironmentLabel(value);
    const environment = normalized ?? ENV_UNKNOWN_FILTER;
    return withBase(`/reports?environment=${encodeURIComponent(environment)}`);
  }
  return withBase(`/reports?tags=${encodeURIComponent(`${key}:${value}`)}`);
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
          to={metadataFilterHref(key, value)}
          title={`Show reports with ${key}: ${value}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs hover:bg-muted"
        >
          <span className="text-muted-foreground">{key}</span>
          <span className="max-w-[24rem] truncate font-medium">
            {key === 'environment' ? (getEnvironmentLabel(value) ?? 'Unknown') : value}
          </span>
        </Link>
      ))}
    </div>
  );
}
