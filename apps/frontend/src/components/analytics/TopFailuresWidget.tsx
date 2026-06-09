'use client';

import { ExternalLink } from 'lucide-react';
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
}

interface ErrorGroup {
  message: string;
  category: string;
  count: number;
  signature: string;
  sampleReportId?: string;
  sampleReportUrl?: string;
  sampleTestId?: string;
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

function ExampleList({ tests, totalCount, groupKey }: Readonly<ExampleListProps>) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? tests : tests.slice(0, 1);
  const hidden = tests.length - visible.length;

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
                <div className="text-muted-foreground break-words">
                  {t.project}
                  {t.filePath ? ` · ${t.filePath}` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {tests.length > 1 && (
        <button
          type="button"
          className="mt-1 text-primary hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll((v) => !v);
          }}
        >
          {showAll ? 'Show less' : `Show ${hidden} more`}
        </button>
      )}
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
              <div
                key={error.signature}
                className="border rounded-lg p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setExpandedIndex(expandedIndex === index ? null : index);
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
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
                  <Badge variant="secondary" className="shrink-0">
                    {error.count}x
                  </Badge>
                </div>
                {expandedIndex === index && (
                  <div className="mt-2 space-y-2">
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
                      {error.message}
                    </pre>
                    {error.sampleReportUrl && error.sampleTestId && (
                      <RouterLink
                        to={`${withBase(error.sampleReportUrl)}#?testId=${error.sampleTestId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open this failure in the Playwright report
                      </RouterLink>
                    )}
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
