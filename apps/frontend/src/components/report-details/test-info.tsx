import type { ReportTest } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { ArrowUpRight, Clock } from 'lucide-react';
import type { FC } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { testStatusToColor } from '@/lib/tailwind';
import RootCauseCategoryEditor from './RootCauseCategoryEditor';

interface TestInfoProps {
  test: ReportTest;
  project?: string;
  reportId?: string;
  suitePath?: string[];
  fileName?: string;
}

const TestInfo: FC<TestInfoProps> = ({ test, project, reportId, suitePath, fileName }) => {
  const formatted = testStatusToColor(test.outcome || 'expected');
  const detailHref =
    test.testId && project
      ? `/test/${test.testId}?project=${encodeURIComponent(project)}`
      : undefined;
  const showRootCause =
    reportId &&
    test.testId &&
    project &&
    (test.outcome === 'unexpected' || test.outcome === 'flaky');

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="space-y-1">
        {(fileName || suitePath?.length) && (
          <p className="text-xs text-muted-foreground truncate">
            {[fileName, ...(suitePath ?? [])].filter(Boolean).join(' › ')}
          </p>
        )}
        <h3 className="font-medium leading-snug">{test.title}</h3>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className={formatted.colorName}>
          {formatted.title}
        </Badge>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(test.duration || 0)}
        </span>
        {test.projectName && <Badge variant="secondary">{test.projectName}</Badge>}
        {test.tags?.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>

      {showRootCause && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Root cause</span>
          <RootCauseCategoryEditor
            testId={test.testId as string}
            reportId={reportId as string}
            project={project as string}
          />
        </div>
      )}

      {test.annotations && test.annotations.length > 0 && (
        <div className="space-y-1 text-sm">
          {test.annotations.map((annotation) => (
            <p key={`${annotation.type}:${annotation.description ?? ''}`}>
              <span className="text-muted-foreground">{annotation.type}</span>
              {annotation.description ? `: ${annotation.description}` : ''}
            </p>
          ))}
        </div>
      )}

      {detailHref && (
        <RouterLink
          to={detailHref}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open full test page
          <ArrowUpRight className="h-3.5 w-3.5" />
        </RouterLink>
      )}
    </div>
  );
};

export default TestInfo;
