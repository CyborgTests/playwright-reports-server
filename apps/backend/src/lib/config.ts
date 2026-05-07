import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { defaultLinks } from '../config/site.js';

const defaultReportExpirationDays = '90';
const defaultResultExpirationDays = '30';

export const defaultConfig: SiteWhiteLabelConfig = {
  title: '', // Empty since logo contains text
  headerLinks: defaultLinks,
  logoPath: '/logo.svg',
  faviconPath: '/favicon.ico',
  reporterPaths: [],
  cron: {
    resultExpireDays: Number(process.env.RESULT_EXPIRE_DAYS ?? defaultResultExpirationDays),
    resultExpireCronSchedule: process.env.RESULT_EXPIRE_CRON_SCHEDULE ?? '0 2 * * *',
    reportExpireDays: Number(process.env.REPORT_EXPIRE_DAYS ?? defaultReportExpirationDays),
    reportExpireCronSchedule: process.env.REPORT_EXPIRE_CRON_SCHEDULE ?? '0 3 * * *',
  },
  testManagement: {
    quarantineThresholdPercentage: Number(process.env.TEST_FLAKINESS_QUARANTINE_THRESHOLD ?? 5),
    warningThresholdPercentage: Number(process.env.TEST_FLAKINESS_WARNING_THRESHOLD ?? 2),
    autoQuarantineEnabled: process.env.TEST_FLAKINESS_AUTO_QUARANTINE === 'true',
    flakinessMinRuns: Number(process.env.TEST_FLAKINESS_MIN_RUNS ?? 1),
    flakinessEvaluationWindowDays: Number(process.env.TEST_FLAKINESS_EVALUATION_WINDOW_DAYS ?? 30),
  },
};

export const isConfigValid = (config: unknown): config is SiteWhiteLabelConfig => {
  return (
    !!config &&
    typeof config === 'object' &&
    'title' in config &&
    'headerLinks' in config &&
    'logoPath' in config &&
    'faviconPath' in config
  );
};
