import type { DateRange } from '@playwright-reports/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import LazyVisible from '@/components/lazy-visible';
import { useFailureCategories } from '@/hooks/useFailureCategories';
import { FailureCategoryChart } from './FailureCategoryChart';
import { TopFailuresWidget } from './TopFailuresWidget';

const FailureAnalysisSummary = lazy(() =>
  import('./FailureAnalysisSummary').then((m) => ({ default: m.FailureAnalysisSummary }))
);

interface FailureCategoriesSectionProps {
  project?: string;
  dateRange?: DateRange;
  onCategoryClick: (category: string) => void;
  reportIds: string[];
}

/**
 * Self-contained failure-analytics section: owns its own data fetch so the
 * expensive aggregation never blocks the main analytics payload. Mounted via
 * LazyVisible — the request fires only when the section scrolls into view.
 */
export function FailureCategoriesSection({
  project,
  dateRange,
  onCategoryClick,
  reportIds,
}: Readonly<FailureCategoriesSectionProps>) {
  const [deferred, setDeferred] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the delay whenever filters change
  useEffect(() => {
    setDeferred(false);
    const t = setTimeout(() => setDeferred(true), 250);
    return () => clearTimeout(t);
  }, [project, dateRange?.from, dateRange?.to]);

  const { data: failureCategories, isPending: isFailureCategoriesLoading } = useFailureCategories(
    project,
    dateRange,
    deferred
  );

  const totalFailures = failureCategories?.totalFailures ?? 0;

  if (!isFailureCategoriesLoading && totalFailures === 0) return null;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FailureCategoryChart
          categories={failureCategories?.categories}
          totalFailures={totalFailures}
          isLoading={isFailureCategoriesLoading}
          onCategoryClick={onCategoryClick}
        />
        <TopFailuresWidget
          errors={failureCategories?.topErrors}
          isLoading={isFailureCategoriesLoading}
        />
      </div>

      <LazyVisible rootMargin="200px 0px">
        <Suspense fallback={null}>
          <FailureAnalysisSummary
            project={project}
            reportIds={reportIds}
            totalFailures={totalFailures}
          />
        </Suspense>
      </LazyVisible>
    </>
  );
}
