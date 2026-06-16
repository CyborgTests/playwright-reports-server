import type { ReportHistory } from '@playwright-reports/shared';
import { type FC, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import InlineStatsCircle from '@/components/inline-stats-circle';
import { subtitle } from '@/components/primitives';
import { StatChart } from '@/components/stat-chart';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import useQuery from '@/hooks/useQuery';
import FileSuitesTree, { StatsBadges } from './suite-tree';
import ReportFilters from './tests-filters';

interface FileListProps {
  report?: ReportHistory | null;
  highlightTestId?: string;
}

const FileList: FC<FileListProps> = ({ report, highlightTestId }) => {
  const {
    data: history,
    isLoading: isHistoryLoading,
    error: historyError,
  } = useQuery<ReportHistory[]>(`/api/report/list?limit=10&project=${report?.project ?? ''}`, {
    dependencies: [report?.reportID],
  });

  const [filteredTests, setFilteredTests] = useState<ReportHistory | undefined>(
    report ?? undefined
  );
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  useEffect(() => {
    if (historyError) {
      toast.error(historyError.message);
    }
  }, [historyError]);

  const newRegressionTestIds = useMemo(
    () => new Set((report?.regressions?.newTests ?? []).map((t) => t.testId)),
    [report?.regressions?.newTests]
  );
  const resolvedRegressionTestIds = useMemo(
    () => new Set((report?.regressions?.resolvedTests ?? []).map((t) => t.testId)),
    [report?.regressions?.resolvedTests]
  );

  useEffect(() => {
    if (highlightTestId && filteredTests?.files) {
      const fileWithTest = filteredTests.files.find((file) =>
        file.tests?.some((test) => test.testId === highlightTestId)
      );
      if (fileWithTest?.fileId) {
        setExpandedKeys((prev) =>
          prev.includes(fileWithTest.fileId) ? prev : [...prev, fileWithTest.fileId]
        );
      }
    }
  }, [highlightTestId, filteredTests]);

  if (!report) {
    return (
      <div className="flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return isHistoryLoading ? (
    <div className="flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  ) : (
    <div>
      <div className="flex flex-row justify-between">
        <h2 className={subtitle()}>File list</h2>
        <ReportFilters report={report} onChangeFilters={setFilteredTests} />
      </div>
      {filteredTests?.files?.length ? (
        <Accordion
          type="multiple"
          value={expandedKeys}
          onValueChange={setExpandedKeys}
          className="w-full"
        >
          {(filteredTests?.files ?? []).map((file) => (
            <AccordionItem key={file.fileId} value={file.fileId}>
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-row items-center gap-3 flex-1 flex-wrap pr-4">
                  <InlineStatsCircle stats={file.stats} />
                  <span className="font-medium">{file.fileName}</span>
                  <StatsBadges stats={file.stats} />
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="file-details space-y-4">
                  <StatChart stats={file.stats} />
                  <div className="file-tests">
                    <h4 className={subtitle()}>Tests</h4>
                    <FileSuitesTree
                      file={file}
                      history={history ?? []}
                      reportId={report?.reportID}
                      project={report?.project}
                      newRegressionTestIds={newRegressionTestIds}
                      resolvedRegressionTestIds={resolvedRegressionTestIds}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <Alert>No files found</Alert>
      )}
    </div>
  );
};

export default FileList;
