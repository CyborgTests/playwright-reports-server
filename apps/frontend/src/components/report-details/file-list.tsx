import type { ReportHistory } from '@playwright-reports/shared';
import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import InlineStatsCircle from '@/components/inline-stats-circle';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { buildFileGroups } from '@/lib/test-groups';
import { cn } from '@/lib/utils';
import TestGroupList, { StatsBadges } from './suite-tree';
import TestInfo from './test-info';
import ReportFilters from './tests-filters';

interface FileListProps {
  report?: ReportHistory | null;
  highlightTestId?: string;
}

const FileList: FC<FileListProps> = ({ report, highlightTestId }) => {
  const [filteredTests, setFilteredTests] = useState<ReportHistory | undefined>(
    report ?? undefined
  );
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const detailPaneRef = useRef<HTMLDivElement>(null);

  const fileGroups = useMemo(() => buildFileGroups(filteredTests?.files), [filteredTests?.files]);

  const newRegressionTestIds = useMemo(
    () => new Set((report?.regressions?.newTests ?? []).map((t) => t.testId)),
    [report?.regressions?.newTests]
  );
  const resolvedRegressionTestIds = useMemo(
    () => new Set((report?.regressions?.resolvedTests ?? []).map((t) => t.testId)),
    [report?.regressions?.resolvedTests]
  );

  useEffect(() => {
    setExpandedKeys(
      (report?.files ?? [])
        .filter((file) => (file.stats.unexpected ?? 0) + (file.stats.flaky ?? 0) > 0)
        .map((file) => file.fileId)
    );
  }, [report?.files]);

  useEffect(() => {
    if (!highlightTestId) return;
    setSelectedTestId(highlightTestId);
    const file = (report?.files ?? []).find((entry) =>
      (entry.tests ?? []).some((test) => test.testId === highlightTestId)
    );
    if (file) {
      setExpandedKeys((prev) => (prev.includes(file.fileId) ? prev : [...prev, file.fileId]));
    }
  }, [highlightTestId, report?.files]);

  useEffect(() => {
    if (!selectedTestId) return;
    const pane = detailPaneRef.current;
    if (!pane) return;
    pane.scrollTop = 0;
    pane.scrollIntoView({ block: 'nearest' });
  }, [selectedTestId]);

  const selection = useMemo(() => {
    if (!selectedTestId) return null;
    for (const group of fileGroups) {
      const test = (group.file.tests ?? []).find((entry) => entry.testId === selectedTestId);
      if (test) return { test, fileName: group.file.fileName };
    }
    return null;
  }, [selectedTestId, fileGroups]);

  if (!report) {
    return (
      <div className="flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <ReportFilters report={report} onChangeFilters={setFilteredTests} />
      </div>

      {fileGroups.length ? (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="w-full lg:flex-1 lg:min-w-0">
            <Accordion
              type="multiple"
              value={expandedKeys}
              onValueChange={setExpandedKeys}
              className="w-full"
            >
              {fileGroups.map((group) => (
                <AccordionItem key={group.file.fileId} value={group.file.fileId}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-row items-center gap-3 flex-1 flex-wrap pr-4 text-left">
                      <InlineStatsCircle stats={group.file.stats} />
                      <span className="font-medium">
                        {group.file.fileName}
                        {group.prefix.length > 0 && (
                          <span className="text-muted-foreground font-normal">
                            {' › '}
                            {group.prefix.join(' › ')}
                          </span>
                        )}
                      </span>
                      <StatsBadges stats={group.file.stats} />
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <TestGroupList
                      groups={group.groups}
                      fileHasProblems={group.problems > 0}
                      selectedTestId={selectedTestId ?? undefined}
                      newRegressionTestIds={newRegressionTestIds}
                      resolvedRegressionTestIds={resolvedRegressionTestIds}
                      onSelect={(test) => setSelectedTestId(test.testId ?? null)}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <div
            ref={detailPaneRef}
            className={cn(
              'w-full lg:flex-1 lg:min-w-0 lg:sticky lg:top-4',
              'lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto',
              !selection && 'hidden lg:block'
            )}
          >
            {selection ? (
              <TestInfo
                test={selection.test}
                project={report.project}
                reportId={report.reportID}
                fileName={selection.fileName}
                suitePath={selection.test.path}
                reportUrl={report.reportUrl}
              />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Select a test to see details and links.
              </div>
            )}
          </div>
        </div>
      ) : (
        <Alert>No files found</Alert>
      )}
    </div>
  );
};

export default FileList;
