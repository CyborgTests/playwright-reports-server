import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCategoryName } from '@/lib/format';
import { withBase } from '@/lib/url';

interface AffectedTest {
  testId: string;
  title: string;
  filePath?: string;
  project: string;
  reportId: string;
  reportUrl?: string;
  isRegressed?: boolean;
}

interface ErrorGroup {
  message: string;
  category: string;
  count: number;
  signature: string;
  sampleReportId?: string;
  sampleReportUrl?: string;
  sampleTestId?: string;
  /** Number of affectedTests currently in an open regression. */
  regressedTestCount?: number;
  affectedTests?: AffectedTest[];
}

interface TopFailuresWidgetProps {
  errors?: ErrorGroup[];
  isLoading?: boolean;
}

const categoryVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  timeout: 'secondary',
  assertion_error: 'destructive',
  element_not_found: 'outline',
  network_error: 'destructive',
  unknown: 'outline',
};

interface ExampleListProps {
  tests: AffectedTest[];
  totalCount: number;
  groupKey: string;
}

const EXAMPLE_LIST_MAX = 5;

function ExampleList({ tests, totalCount, groupKey }: Readonly<ExampleListProps>) {
  const visible = tests.slice(0, EXAMPLE_LIST_MAX);
  const overflow = tests.length - visible.length;

  return (
    <div className="text-xs">
      <div className="font-medium mb-1 text-muted-foreground">
        Examples ({tests.length}
        {totalCount > tests.length ? ` of ${totalCount}` : ''})
      </div>
      <ul className="space-y-1">
        {visible.map((t) => {
          const link = t.reportUrl ? `${withBase(t.reportUrl)}#?testId=${t.testId}` : null;
          return (
            <li
              key={`${groupKey}-${t.reportId}-${t.testId}-${t.project}`}
              className="flex items-start gap-2"
            >
              <span className="text-muted-foreground shrink-0">•</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {link ? (
                    <RouterLink
                      to={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline break-words"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.title}
                    </RouterLink>
                  ) : (
                    <span className="break-words">{t.title}</span>
                  )}
                  {t.isRegressed && (
                    <span
                      className="inline-flex items-center rounded-full border border-danger/40 bg-danger/5 px-1.5 text-[10px] font-medium text-danger"
                      title="This test currently has an open regression"
                    >
                      regressed
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground break-words">
                  {t.project}
                  {t.filePath ? ` · ${t.filePath}` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {overflow > 0 && <div className="mt-1 text-muted-foreground">+{overflow} more not shown</div>}
    </div>
  );
}

export function TopFailuresWidget({ errors, isLoading }: Readonly<TopFailuresWidgetProps>) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const topErrors = (errors ?? []).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Most Common Failures</h3>
        <p className="text-sm text-muted-foreground">Top error patterns across recent reports</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : topErrors.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No failure data available</div>
        ) : (
          <div className="space-y-3">
            {topErrors.map((error, index) => (
              <div key={error.signature} className="border rounded-lg p-3">
                <button
                  type="button"
                  aria-expanded={expandedIndex === index}
                  className="flex w-full items-center justify-between gap-2 text-left rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={categoryVariant[error.category] ?? 'outline'}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {formatCategoryName(error.category)}
                    </Badge>
                    <span className="text-sm text-muted-foreground truncate">
                      {error.message.substring(0, 100)}
                      {error.message.length > 100 ? '...' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {error.regressedTestCount !== undefined && error.regressedTestCount > 0 && (
                      <Badge
                        variant="danger"
                        className="whitespace-nowrap"
                        title={`${error.regressedTestCount} of the affected tests have an open regression — likely a real recent breakage rather than a chronic flake`}
                      >
                        {error.regressedTestCount} regressed
                      </Badge>
                    )}
                    <Badge variant="secondary">{error.count}x</Badge>
                  </div>
                </button>
                {expandedIndex === index && (
                  <div className="mt-2 space-y-2">
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
                      {error.message}
                    </pre>
                    {error.affectedTests && error.affectedTests.length > 0 && (
                      <ExampleList
                        tests={error.affectedTests}
                        totalCount={error.count}
                        groupKey={error.signature}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
