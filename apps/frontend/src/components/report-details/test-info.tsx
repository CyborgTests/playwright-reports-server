import type { ReportTest } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { ArrowUpRight, Clock } from 'lucide-react';
import type { FC } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { outcomeBadge } from '@/components/outcome-badge';
import { Badge } from '@/components/ui/badge';
import { isProblemTest } from '@/lib/test-groups';
import { servedTestUrl } from '@/lib/url';
import RootCauseCategoryEditor from './RootCauseCategoryEditor';
import TestDebugPanel from './test-debug-panel';

interface TestInfoProps {
  test: ReportTest;
  project?: string;
  reportId?: string;
  suitePath?: string[];
  fileName?: string;
  reportUrl?: string | null;
}

const TestInfo: FC<TestInfoProps> = ({
  test,
  project,
  reportId,
  suitePath,
  fileName,
  reportUrl,
}) => {
  const { testId } = test;
  const detailHref =
    testId && project ? `/test/${testId}?project=${encodeURIComponent(project)}` : undefined;
  const reportHref = testId ? servedTestUrl(reportUrl, testId) : undefined;
  const isFailing = isProblemTest(test);

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
        {outcomeBadge(test.outcome)}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(test.duration || 0)}
        </span>
        {test.projectName && <Badge variant="secondary">{test.projectName}</Badge>}
        {test.tags?.map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="font-normal text-muted-foreground border border-border"
          >
            {tag}
          </Badge>
        ))}
      </div>

      {isFailing && testId && reportId && project && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Root cause</span>
          <RootCauseCategoryEditor testId={testId} reportId={reportId} project={project} />
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

      {isFailing && testId && reportId && (
        <TestDebugPanel reportId={reportId} testId={testId} project={project} />
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        {detailHref && (
          <RouterLink
            to={detailHref}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open test details
            <ArrowUpRight className="h-3.5 w-3.5" />
          </RouterLink>
        )}
        {reportHref && (
          <a
            href={reportHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open in Playwright report
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
};

export default TestInfo;
