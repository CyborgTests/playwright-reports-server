import type {
  ReportHistory,
  ReportTest,
  ReportTestOutcome,
  TestHistory,
} from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { ExternalLink } from 'lucide-react';
import type { FC } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import FormattedDate from '@/components/date-format';
import { LinkIcon } from '@/components/icons';
import { subtitle } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { testStatusToColor } from '@/lib/tailwind';
import { withBase } from '@/lib/url';

interface TestInfoProps {
  history: ReportHistory[];
  test: ReportTest;
  /** The report's project (DB key), NOT the Playwright project name on the test. */
  project?: string;
}

const getTestHistory = (testId: string, history: ReportHistory[]) => {
  if (!testId || !Array.isArray(history)) {
    return [];
  }

  return history
    .map((report) => {
      if (!report?.files) {
        return null;
      }

      const file = report.files.find((file) => file.tests?.some((test) => test.testId === testId));

      if (!file) {
        return null;
      }

      const test = file.tests?.find((test) => test.testId === testId);

      if (!test) {
        return null;
      }

      return {
        ...test,
        createdAt: report.createdAt,
        reportID: report.reportID,
        reportUrl: report.reportUrl,
      } as TestHistory;
    })
    .filter((item): item is TestHistory => item !== null);
};

const TestInfo: FC<TestInfoProps> = ({ test, history, project }: TestInfoProps) => {
  if (!test) {
    return <div className="shadow-md rounded-lg p-6">No test data available</div>;
  }

  const formatted = testStatusToColor(test.outcome || 'expected');
  const safeHistory = Array.isArray(history) ? history : [];
  const testHistory = getTestHistory(test.testId || 'unknown', safeHistory);
  const detailHref =
    test.testId && project
      ? `/test/${test.testId}?project=${encodeURIComponent(project)}`
      : undefined;

  return (
    <div className="shadow-md rounded-lg p-6">
      <div className="mb-4 space-y-1">
        <p>
          Outcome: <span className={formatted.color}>{formatted.title}</span>
        </p>
        <p>
          Location:{' '}
          {`${test.location?.file || 'unknown'}:${test.location?.line || 0}:${test.location?.column || 0}`}
        </p>
        <p>Duration: {formatDuration(test.duration || 0)}</p>
        {test.annotations && test.annotations.length > 0 && (
          <p>Annotations: {test.annotations.map((a) => JSON.stringify(a)).join(', ')}</p>
        )}
        {test.tags && test.tags.length > 0 && <p>Tags: {test.tags.join(', ')}</p>}
        {detailHref && (
          <div className="pt-2">
            <Button variant="outline" size="sm" asChild>
              <RouterLink to={detailHref}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                View test details
              </RouterLink>
            </Button>
          </div>
        )}
      </div>
      {!!testHistory?.length && (
        <div>
          <h3 className={subtitle()}>Results:</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created At</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {testHistory.filter(Boolean).map((item) => {
                const itemOutcome = testStatusToColor(
                  (item.outcome as ReportTestOutcome) || 'expected'
                );

                return (
                  <TableRow key={`${item.reportID}-${item.testId}`}>
                    <TableCell className="w-3/8">
                      <FormattedDate date={item.createdAt || ''} />
                    </TableCell>
                    <TableCell className="w-2/8">
                      <span className={itemOutcome.color}>{itemOutcome.title}</span>
                    </TableCell>
                    <TableCell className="w-2/8">{formatDuration(item.duration || 0)}</TableCell>
                    <TableCell className="w-1/8">
                      <RouterLink
                        to={`${withBase(item.reportUrl || '')}#?testId=${item.testId || ''}`}
                        target="_blank"
                      >
                        <LinkIcon />
                      </RouterLink>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default TestInfo;
