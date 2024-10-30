import { ReportFile, ReportTest, ReportTestFilters } from '@/app/lib/parser';
import { ReportHistory } from '@/app/lib/storage/types';

const isTestMatchingFilters = (test: ReportTest, filters?: ReportTestFilters): boolean => {
  if (!filters) {
    return true;
  }
  const byOutcome = !filters.outcomes || filters.outcomes.includes(test.outcome);
  const byTitle = !filters.name || test.title.toLowerCase().includes(filters.name.toLowerCase());

  return byOutcome && byTitle;
};

export const filterReportHistory = (
  report: ReportHistory,
  filters?: ReportTestFilters,
): ReportHistory & { testCount: number; totalTestCount: number } => {
  const filtered = structuredClone(report);
  const counter = {
    testCount: 0,
    totalTestCount: 0,
  };
  const filteredFiles = filtered.files.reduce((files, file) => {
    counter.totalTestCount += file.tests.length;
    const filteredTests = file.tests.filter((test) => isTestMatchingFilters(test, filters));

    counter.testCount += filteredTests.length;

    const fileHasTests = filteredTests.length > 0;

    if (!fileHasTests) {
      return files;
    }

    file.tests = filteredTests;

    files.push(file);

    return files;
  }, [] as ReportFile[]);

  filtered.files = filteredFiles;

  return {
    ...filtered,
    ...counter,
  };
};

export const pluralize = (count: number, singular: string, plural: string, locale: string = 'en-US'): string => {
  const pluralRules = new Intl.PluralRules(locale);
  const rule = pluralRules.select(count);

  return rule === 'one' ? singular : plural;
};
