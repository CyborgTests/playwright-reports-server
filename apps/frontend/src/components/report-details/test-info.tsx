import type { ReportTest } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { ExternalLink } from 'lucide-react';
import type { FC } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { testStatusToColor } from '@/lib/tailwind';
import RootCauseCategoryEditor from './RootCauseCategoryEditor';

interface TestInfoProps {
  test: ReportTest;
  project?: string;
  reportId?: string;
}

const TestInfo: FC<TestInfoProps> = ({ test, project, reportId }: TestInfoProps) => {
  const formatted = testStatusToColor(test.outcome || 'expected');
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
        {reportId &&
          test.testId &&
          project &&
          (test.outcome === 'unexpected' || test.outcome === 'flaky') && (
            <div className="flex items-center gap-2">
              <span>Root cause:</span>
              <RootCauseCategoryEditor testId={test.testId} reportId={reportId} project={project} />
            </div>
          )}
        <p>Duration: {formatDuration(test.duration || 0)}</p>
        {test.annotations && test.annotations.length > 0 && (
          <p>
            Annotations:{' '}
            {test.annotations
              .map((a) => (a.description ? `${a.type}: ${a.description}` : a.type))
              .join(', ')}
          </p>
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
    </div>
  );
};

export default TestInfo;
