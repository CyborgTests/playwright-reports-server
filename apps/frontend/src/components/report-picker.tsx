'use client';

import { API_ENDPOINTS, type ReadReportsOutput } from '@playwright-reports/shared';
import { FileText, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import FormattedDate from '@/components/date-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import useQuery from '@/hooks/useQuery';
import { buildUrl } from '@/lib/url';

interface ReportPickerProps {
  selectedReportId?: string;
  onSelect: (reportId: string | undefined) => void;
  defaultProject?: string;
  className?: string;
}

const LIMIT = 50;

export default function ReportPicker({
  selectedReportId,
  onSelect,
  defaultProject,
  className,
}: Readonly<ReportPickerProps>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const queryUrl = useMemo(() => {
    const params: Record<string, string> = {
      limit: String(LIMIT),
      offset: '0',
      passRate: 'failing',
    };
    if (defaultProject && defaultProject !== 'All') {
      params.project = defaultProject;
    }
    return buildUrl(API_ENDPOINTS.REPORTS_LIST, params);
  }, [defaultProject]);

  const { data, isLoading } = useQuery<ReadReportsOutput>(queryUrl, {
    dependencies: [defaultProject],
    enabled: open,
    staleTime: 30_000,
  });

  const allReports = useMemo(() => data?.reports ?? [], [data]);

  const trimmedSearch = search.trim().toLowerCase();
  const reports = useMemo(() => {
    if (!trimmedSearch) return allReports;
    return allReports.filter((r) => {
      const haystack = [
        r.title ?? '',
        r.project,
        r.reportID,
        r.displayNumber ? `#${r.displayNumber}` : '',
        r.displayNumber ? String(r.displayNumber) : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(trimmedSearch);
    });
  }, [allReports, trimmedSearch]);

  const selectedReport = useMemo(
    () => (selectedReportId ? allReports.find((r) => r.reportID === selectedReportId) : undefined),
    [selectedReportId, allReports]
  );

  const triggerLabel = selectedReport
    ? `${selectedReport.displayNumber ? `#${selectedReport.displayNumber} ` : ''}${selectedReport.title ?? selectedReport.reportID.slice(0, 8)}`
    : undefined;

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <span className="text-sm font-medium">Report</span>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 h-9 w-56 justify-start font-normal"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{triggerLabel ?? 'All reports'}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[420px] max-w-[90vw] p-0"
            align="start"
            side="bottom"
            avoidCollisions={false}
          >
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reports..."
                  className="pl-7 h-8 text-sm"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-[360px] overflow-y-auto">
              {selectedReportId && (
                <button
                  type="button"
                  className="w-full px-3 py-2 border-b text-left text-sm hover:bg-muted/50 transition-colors text-muted-foreground"
                  onClick={() => {
                    onSelect(undefined);
                    setOpen(false);
                  }}
                >
                  Show all reports (clear filter)
                </button>
              )}
              {isLoading && (
                <div className="flex justify-center py-6">
                  <Spinner size="sm" />
                </div>
              )}
              {!isLoading && reports.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {trimmedSearch ? 'No matches.' : 'No reports with failures found.'}
                </div>
              )}
              {reports.map((report) => {
                const failed = report.stats?.unexpected ?? 0;
                const flaky = report.stats?.flaky ?? 0;
                return (
                  <button
                    type="button"
                    key={report.reportID}
                    className={`w-full px-3 py-2 border-b last:border-b-0 hover:bg-muted/50 transition-colors text-sm text-left ${
                      report.reportID === selectedReportId ? 'bg-muted/70' : ''
                    }`}
                    onClick={() => {
                      onSelect(report.reportID);
                      setOpen(false);
                    }}
                  >
                    <div className="font-medium truncate">
                      {report.displayNumber ? `#${report.displayNumber} ` : ''}
                      {report.title ?? report.reportID.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      <span>{report.project}</span>
                      <span>&middot;</span>
                      <FormattedDate date={report.createdAt} />
                      <span>&middot;</span>
                      <span>
                        {report.stats?.total ?? 0} tests
                        {failed > 0 && (
                          <span className="text-destructive ml-1">{failed} failed</span>
                        )}
                        {flaky > 0 && <span className="text-warning ml-1">{flaky} flaky</span>}
                      </span>
                    </div>
                  </button>
                );
              })}
              {!isLoading && data && allReports.length >= LIMIT && (
                <div className="px-3 py-2 text-center text-[10px] text-muted-foreground">
                  Showing latest {LIMIT} reports with failures
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {selectedReportId && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => onSelect(undefined)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
