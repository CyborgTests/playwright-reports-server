import { type Report, type Result, type ReportHistory, type SortOrder } from './types';

export type ReportSortField = 'createdAt' | 'title' | 'project' | 'level' | 'passRate' | 'size';
export type ResultSortField = 'createdAt' | 'title' | 'project' | 'level' | 'tags' | 'size';

export const REPORT_SORT_FIELDS: readonly ReportSortField[] = [
  'createdAt',
  'title',
  'project',
  'level',
  'passRate',
  'size',
];

export const RESULT_SORT_FIELDS: readonly ResultSortField[] = [
  'createdAt',
  'title',
  'project',
  'level',
  'tags',
  'size',
];

export const parseReportSortField = (value: string | null | undefined): ReportSortField | undefined =>
  (REPORT_SORT_FIELDS as readonly string[]).includes(value ?? '') ? (value as ReportSortField) : undefined;

export const parseResultSortField = (value: string | null | undefined): ResultSortField | undefined =>
  (RESULT_SORT_FIELDS as readonly string[]).includes(value ?? '') ? (value as ResultSortField) : undefined;

const toTimestamp = (date?: Date | string) => {
  if (!date) return 0;
  if (typeof date === 'string') return new Date(date).getTime();

  return date.getTime();
};

const RESULT_METADATA_EXCLUDE = ['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project', 'level'];

const resultTagsString = (item: Result): string =>
  Object.entries(item)
    .filter(([key]) => !RESULT_METADATA_EXCLUDE.includes(key))
    .map(([key, value]) => `${key}: ${value}`)
    .sort()
    .join(', ')
    .toLowerCase();

const reportPassRate = (item: ReportHistory): number => {
  const stats = item.stats;

  if (!stats) return 0;
  const total = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0) + (stats.skipped ?? 0);

  if (total === 0) return 0;

  return (stats.expected ?? 0) / total;
};

export const getReportSortValue = (item: ReportHistory, field: ReportSortField): number | string => {
  switch (field) {
    case 'createdAt':
      return toTimestamp(item.createdAt);
    case 'title':
      return (item.title ?? item.reportID ?? '').toLowerCase();
    case 'project':
      return (item.project ?? '').toLowerCase();
    case 'level':
      return (item.level ?? '').toLowerCase();
    case 'passRate':
      return reportPassRate(item);
    case 'size':
      return item.sizeBytes ?? 0;
  }
};

export const getResultSortValue = (item: Result, field: ResultSortField): number | string => {
  switch (field) {
    case 'createdAt':
      return toTimestamp(item.createdAt);
    case 'title':
      return (item.title ?? item.resultID ?? '').toLowerCase();
    case 'project':
      return (item.project ?? '').toLowerCase();
    case 'level':
      return (item.level ?? '').toLowerCase();
    case 'tags':
      return resultTagsString(item);
    case 'size':
      return item.sizeBytes ?? 0;
  }
};

const compareValues = (a: number | string, b: number | string): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;

  return String(a).localeCompare(String(b));
};

export const compareReports = (
  a: ReportHistory,
  b: ReportHistory,
  field: ReportSortField,
  order: SortOrder,
): number => {
  const dir = order === 'asc' ? 1 : -1;

  return dir * compareValues(getReportSortValue(a, field), getReportSortValue(b, field));
};

export const compareResults = (a: Result, b: Result, field: ResultSortField, order: SortOrder): number => {
  const dir = order === 'asc' ? 1 : -1;

  return dir * compareValues(getResultSortValue(a, field), getResultSortValue(b, field));
};

// Re-export for callers that only need the timestamp helper.
export const getTimestamp = toTimestamp;

// Loose helper for the type-erased `Report` (used in storage layers where we sort before metadata merge in some backends).
export const compareReportsLoose = (a: Report, b: Report, field: ReportSortField, order: SortOrder): number =>
  compareReports(a as ReportHistory, b as ReportHistory, field, order);
