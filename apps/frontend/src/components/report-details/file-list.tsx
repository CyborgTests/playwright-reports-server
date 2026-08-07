import type { ReportHistory, ReportTest } from '@playwright-reports/shared';
import { type FC, useEffect, useMemo, useState } from 'react';
import InlineStatsCircle from '@/components/inline-stats-circle';
import { subtitle } from '@/components/primitives';
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

interface Selection {
  test: ReportTest;
  fileName: string;
  suitePath: string[];
}

const FileList: FC<FileListProps> = ({ report, highlightTestId }) => {
  const [filteredTests, setFilteredTests] = useState<ReportHistory | undefined>(
    report ?? undefined
  );
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);

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
      fileGroups.filter((group) => group.problems > 0).map((group) => group.file.fileId)
    );
  }, [fileGroups]);

  useEffect(() => {
    if (!highlightTestId) return;
    for (const group of fileGroups) {
      const test = (group.file.tests ?? []).find((entry) => entry.testId === highlightTestId);
      if (!test) continue;
      setSelection({ test, fileName: group.file.fileName, suitePath: group.prefix });
      setExpandedKeys((prev) =>
        prev.includes(group.file.fileId) ? prev : [...prev, group.file.fileId]
      );
      return;
    }
  }, [highlightTestId, fileGroups]);

  if (!report) {
    return (
      <div className="flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className={subtitle()}>File list</h2>
        <ReportFilters report={report} onChangeFilters={setFilteredTests} />
      </div>

      {fileGroups.length ? (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="w-full lg:w-1/2 xl:w-[55%]">
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
                      selectedTestId={selection?.test.testId}
                      newRegressionTestIds={newRegressionTestIds}
                      resolvedRegressionTestIds={resolvedRegressionTestIds}
                      onSelect={(test) =>
                        setSelection({
                          test,
                          fileName: group.file.fileName,
                          suitePath: group.prefix,
                        })
                      }
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <div
            className={cn(
              'w-full lg:w-1/2 xl:w-[45%] lg:sticky lg:top-4',
              !selection && 'hidden lg:block'
            )}
          >
            {selection ? (
              <TestInfo
                test={selection.test}
                project={report.project}
                reportId={report.reportID}
                fileName={selection.fileName}
                suitePath={selection.suitePath}
                reportUrl={report.reportUrl}
              />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Select a test to see its outcome, root cause and tags.
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
