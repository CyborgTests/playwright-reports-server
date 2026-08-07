import type { ReportStats, ReportTest } from '@playwright-reports/shared';
import { ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { testStatusToColor } from '@/lib/tailwind';
import { isProblemTest, type TestGroup } from '@/lib/test-groups';
import { pluralize } from '@/lib/transformers';
import { cn } from '@/lib/utils';

export function StatsBadges({ stats }: { stats: ReportStats }) {
  if (!stats.total) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground font-normal flex-wrap">
      <span>
        {stats.total} {pluralize(stats.total, 'test')}
      </span>
      {(stats.unexpected ?? 0) > 0 && <Badge variant="danger">{stats.unexpected} failed</Badge>}
      {(stats.flaky ?? 0) > 0 && <Badge variant="warning">{stats.flaky} flaky</Badge>}
      {(stats.expected ?? 0) > 0 && <Badge variant="success">{stats.expected} passed</Badge>}
      {(stats.skipped ?? 0) > 0 && <Badge variant="secondary">{stats.skipped} skipped</Badge>}
    </span>
  );
}

interface TestRowProps {
  test: ReportTest;
  selected: boolean;
  isNewRegression?: boolean;
  isResolvedRegression?: boolean;
  onSelect: (test: ReportTest) => void;
}

const TestRow = ({
  test,
  selected,
  isNewRegression,
  isResolvedRegression,
  onSelect,
}: TestRowProps) => {
  const status = testStatusToColor(test.outcome || 'expected');
  return (
    <button
      type="button"
      onClick={() => onSelect(test)}
      aria-current={selected}
      className={cn(
        'w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 text-sm',
        'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected && 'bg-muted'
      )}
    >
      <span className={cn('shrink-0 leading-5', status.color)} aria-hidden>
        ●
      </span>
      <span className="flex-1 min-w-0 truncate">{test.title}</span>
      {isNewRegression && (
        <Badge variant="outline" className="border-danger/40 text-danger shrink-0">
          regression
        </Badge>
      )}
      {isResolvedRegression && (
        <Badge variant="outline" className="border-success/40 text-success shrink-0">
          resolved
        </Badge>
      )}
    </button>
  );
};

interface TestGroupListProps {
  groups: TestGroup[];
  fileHasProblems: boolean;
  selectedTestId?: string;
  newRegressionTestIds?: Set<string>;
  resolvedRegressionTestIds?: Set<string>;
  onSelect: (test: ReportTest) => void;
}

const TestGroupListImpl = ({
  groups,
  fileHasProblems,
  selectedTestId,
  newRegressionTestIds,
  resolvedRegressionTestIds,
  onSelect,
}: TestGroupListProps) => {
  const [expandedHealthy, setExpandedHealthy] = useState<string[]>([]);

  const toggle = (label: string) =>
    setExpandedHealthy((prev) =>
      prev.includes(label) ? prev.filter((entry) => entry !== label) : [...prev, label]
    );

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const problems = group.tests.filter(isProblemTest);
        const healthy = group.tests.filter((test) => !isProblemTest(test));
        const foldHealthy = fileHasProblems && healthy.length > 0;
        const healthyOpen = expandedHealthy.includes(group.label);
        const visible = foldHealthy && !healthyOpen ? problems : group.tests;
        const foldLabel = `${healthy.length} passing${
          healthy.some((test) => test.outcome === 'skipped') ? ' and skipped' : ''
        }`;

        if (problems.length === 0 && foldHealthy && !healthyOpen) {
          return (
            <button
              key={group.label || '__root__'}
              type="button"
              onClick={() => toggle(group.label)}
              className="flex w-full items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{group.label || 'Tests'}</span>
              <span className="ml-auto shrink-0">{foldLabel}</span>
            </button>
          );
        }

        return (
          <div key={group.label || '__root__'} className="space-y-0.5">
            {group.label && (
              <p className="px-2 text-xs font-medium text-muted-foreground truncate">
                {group.label}
              </p>
            )}
            {visible.map((test, index) => (
              <TestRow
                key={test.testId || `${group.label}-${index}`}
                test={test}
                selected={!!test.testId && test.testId === selectedTestId}
                isNewRegression={!!test.testId && newRegressionTestIds?.has(test.testId)}
                isResolvedRegression={!!test.testId && resolvedRegressionTestIds?.has(test.testId)}
                onSelect={onSelect}
              />
            ))}
            {foldHealthy && (
              <button
                type="button"
                onClick={() => toggle(group.label)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn('h-3.5 w-3.5 transition-transform', healthyOpen && 'rotate-90')}
                />
                {healthyOpen ? 'Hide' : 'Show'} {foldLabel}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

const TestGroupList = memo(TestGroupListImpl);
export default TestGroupList;
