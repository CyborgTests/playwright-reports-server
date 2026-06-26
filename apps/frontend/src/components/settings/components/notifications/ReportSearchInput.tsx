import type { ReadReportsHistory, ReportHistory } from '@playwright-reports/shared';
import { SearchSelect } from './SearchSelect';

interface ReportSearchInputProps {
  value: string;
  onChange: (reportId: string) => void;
  placeholder?: string;
}

export function ReportSearchInput({
  value,
  onChange,
  placeholder = 'Select a report…',
}: Readonly<ReportSearchInputProps>) {
  return (
    <SearchSelect<ReportHistory>
      fetchUrl="/api/report/list?limit=100&offset=0"
      toItems={(d) => (d as ReadReportsHistory | undefined)?.reports ?? []}
      searchText={(r) =>
        [
          r.title ?? '',
          r.project,
          r.reportID,
          r.displayNumber ? `#${r.displayNumber}` : '',
          r.displayNumber ? String(r.displayNumber) : '',
        ].join(' ')
      }
      triggerMuted={!value}
      triggerLabel={(items) => {
        const selected = items.find((r) => r.reportID === value);
        return selected ? formatSummary(selected) : value || placeholder;
      }}
      searchPlaceholder="Search by title, project, or #…"
      emptyText={(s) => (s ? 'No matches.' : 'No reports available.')}
      maxHeightClass="max-h-[320px]"
      renderItem={(r, close) => (
        <button
          key={r.reportID}
          type="button"
          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-b-0 ${
            r.reportID === value ? 'bg-muted/30' : ''
          }`}
          onClick={() => {
            onChange(r.reportID);
            close();
          }}
        >
          <div className="font-medium truncate">
            {r.displayNumber ? `#${r.displayNumber} ` : ''}
            {r.title || r.reportID.slice(0, 8)}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {r.project}
            {r.stats && (
              <>
                {' · '}
                {r.stats.expected ?? 0}✓
                {(r.stats.unexpected ?? 0) > 0 && (
                  <span className="text-danger ml-0.5">/ {r.stats.unexpected}✗</span>
                )}
                {(r.stats.flaky ?? 0) > 0 && (
                  <span className="text-warning ml-0.5">/ {r.stats.flaky}~</span>
                )}
              </>
            )}
          </div>
        </button>
      )}
    />
  );
}

function formatSummary(r: ReportHistory): string {
  const head = r.displayNumber ? `#${r.displayNumber} ` : '';
  const title = r.title || r.reportID.slice(0, 8);
  const stats = r.stats;
  const passed = stats?.expected ?? 0;
  const failed = stats?.unexpected ?? 0;
  const flaky = stats?.flaky ?? 0;
  return `${head}${title} - ${r.project} (${passed}✓ / ${failed}✗ / ${flaky}~)`;
}
