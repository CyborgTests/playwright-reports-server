import type { ReportHistory, ReportTest } from '@playwright-reports/shared';

export const filterReportHistory = (
  report: ReportHistory,
  filters: {
    status?: string[];
    search?: string;
  }
): ReportHistory & { testCount: number; totalTestCount: number } => {
  if (!report.files) return { ...report, testCount: 0, totalTestCount: 0 };

  let filteredTests: ReportTest[] = [];
  let totalTestCount = 0;

  const filteredFiles = report.files.map((file) => {
    const fileTests = file.tests || [];
    totalTestCount += fileTests.length;

    let filteredFileTests = fileTests;

    if (filters.status && filters.status.length > 0) {
      filteredFileTests = filteredFileTests.filter((test) =>
        filters.status?.includes(test.outcome || 'passed')
      );
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredFileTests = filteredFileTests.filter(
        (test) =>
          test.title?.toLowerCase().includes(searchLower) ||
          test.location?.file?.toLowerCase()?.includes(searchLower)
      );
    }

    filteredTests = [...filteredTests, ...filteredFileTests];

    return {
      ...file,
      tests: filteredFileTests,
    };
  });

  return {
    ...report,
    files: filteredFiles,
    testCount: filteredTests.length,
    totalTestCount,
  } as ReportHistory & { testCount: number; totalTestCount: number };
};

export const pluralize = (count: number, word: string): string => {
  return count === 1 ? word : `${word}s`;
};
