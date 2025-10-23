import { FC } from 'react';
import { Link, LinkIcon, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@heroui/react';

import FormattedDate from '../date-format';

import { subtitle } from '@/app/components/primitives';
import { parseMilliseconds } from '@/app/lib/time';
import { type TestHistory, type ReportHistory } from '@/app/lib/storage';
import { type ReportTest } from '@/app/lib/parser/types';
import { testStatusToColor } from '@/app/lib/tailwind';
import { withBase } from '@/app/lib/url';

interface TestInfoProps {
  history: ReportHistory[];
  test: ReportTest;
}

const getTestHistory = (testId: string, history: ReportHistory[]) => {
  return history
    .map((report) => {
      const file = report?.files?.find((file) => file.tests.some((test) => test.testId === testId));

      if (!file) {
        return;
      }

      const test = file.tests.find((test) => test.testId === testId);

      if (!test) {
        return;
      }

      return {
        ...test,
        createdAt: report.createdAt,
        reportID: report.reportID,
        reportUrl: report.reportUrl,
      };
    })
    .filter(Boolean) as unknown as TestHistory[];
};

const TestInfo: FC<TestInfoProps> = ({ test, history }: TestInfoProps) => {
  const formatted = testStatusToColor(test.outcome);

  const testHistory = getTestHistory(test.testId, history);

  return (
    <div className="shadow-md rounded-lg p-6">
      <div className="mb-4">
        <p>
          Outcome: <span className={formatted.color}>{formatted.title}</span>
        </p>
        <p>Location: {`${test.location.file}:${test.location.line}:${test.location.column}`}</p>
        <p>Duration: {parseMilliseconds(test.duration)}</p>
        {test.annotations.length > 0 && <p>Annotations: {test.annotations.map((a) => JSON.stringify(a)).join(', ')}</p>}
        {test.tags.length > 0 && <p>Tags: {test.tags.join(', ')}</p>}
      </div>
      {!!testHistory?.length && (
        <div>
          <h3 className={subtitle()}>Results:</h3>
          <Table aria-label="Test History">
            <TableHeader>
              <TableColumn>Created At</TableColumn>
              <TableColumn>Status</TableColumn>
              <TableColumn>Duration</TableColumn>
              <TableColumn>Actions</TableColumn>
            </TableHeader>
            <TableBody items={testHistory}>
              {(item) => {
                const itemOutcome = testStatusToColor(item?.outcome);

                return (
                  <TableRow key={`${item.reportID}-${item.testId}`}>
                    <TableCell className="w-3/8">
                      <FormattedDate date={item?.createdAt} />
                    </TableCell>
                    <TableCell className="w-2/8">
                      <span className={itemOutcome.color}>{itemOutcome.title}</span>
                    </TableCell>
                    <TableCell className="w-2/8">{parseMilliseconds(item.duration)}</TableCell>
                    <TableCell className="w-1/8">
                      <Link href={`${withBase(item.reportUrl)}#?testId=${item.testId}`} target="_blank">
                        <LinkIcon />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              }}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default TestInfo;
