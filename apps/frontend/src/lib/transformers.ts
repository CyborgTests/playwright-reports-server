import type { ReportFile, ReportHistory } from '@playwright-reports/shared';
import { canonicalOutcome, countOutcomes } from '@playwright-reports/shared';

export const filterReportHistory = (
  report: ReportHistory,
  filters: {
    status?: string[];
    search?: string;
  }
): ReportHistory & { testCount: number; totalTestCount: number } => {
  if (!report.files) return { ...report, testCount: 0, totalTestCount: 0 };

  let testCount = 0;
  let totalTestCount = 0;
  const filteredFiles: ReportFile[] = [];

  for (const file of report.files) {
    const fileTests = file.tests || [];
    totalTestCount += fileTests.length;

    let filteredFileTests = fileTests;

    if (filters.status && filters.status.length > 0) {
      filteredFileTests = filteredFileTests.filter((test) =>
        filters.status?.includes(canonicalOutcome(test.outcome))
      );
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredFileTests = filteredFileTests.filter(
        (test) =>
          test.title?.toLowerCase().includes(searchLower) ||
          file.fileName?.toLowerCase()?.includes(searchLower) ||
          test.tags?.some((tag) => tag.toLowerCase().includes(searchLower)) ||
          test.annotations?.some((annotation) =>
            annotation.type.toLowerCase().startsWith(searchLower)
          )
      );
    }

    if (filteredFileTests.length === 0) continue;

    testCount += filteredFileTests.length;
    filteredFiles.push({
      ...file,
      tests: filteredFileTests,
      stats: countOutcomes(filteredFileTests.map((test) => test.outcome)),
    });
  }

  return {
    ...report,
    files: filteredFiles,
    testCount,
    totalTestCount,
  } as ReportHistory & { testCount: number; totalTestCount: number };
};

export const pluralize = (count: number, word: string): string => {
  return count === 1 ? word : `${word}s`;
};
