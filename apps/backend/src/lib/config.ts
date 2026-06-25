import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { FLAKINESS_THRESHOLDS } from '@playwright-reports/shared';
import { defaultLinks } from '../config/site.js';

const defaultReportExpirationDays = '90';
const defaultResultExpirationDays = '30';

export const defaultConfig: SiteWhiteLabelConfig = {
  title: '', // Empty since logo contains text
  headerLinks: defaultLinks,
  logoPath: '/logo.svg',
  logoInvertOnDark: true,
  faviconPath: '/favicon.ico',
  reporterPaths: [],
  allowOpenRegistration: false,
  cron: {
    resultExpireDays: Number(process.env.RESULT_EXPIRE_DAYS ?? defaultResultExpirationDays),
    resultExpireCronSchedule: process.env.RESULT_EXPIRE_CRON_SCHEDULE ?? '0 2 * * *',
    reportExpireDays: Number(process.env.REPORT_EXPIRE_DAYS ?? defaultReportExpirationDays),
    reportExpireCronSchedule: process.env.REPORT_EXPIRE_CRON_SCHEDULE ?? '0 3 * * *',
  },
  testManagement: {
    quarantineThresholdPercentage: Number(
      process.env.TEST_FLAKINESS_QUARANTINE_THRESHOLD ?? FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE
    ),
    warningThresholdPercentage: Number(
      process.env.TEST_FLAKINESS_WARNING_THRESHOLD ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE
    ),
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

export const normalizeHeaderLinks = (raw: unknown): SiteWhiteLabelConfig['headerLinks'] => {
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (
          entry
        ): entry is {
          id?: unknown;
          label?: unknown;
          url?: unknown;
          icon?: unknown;
          showLabel?: unknown;
        } => {
          return !!entry && typeof entry === 'object';
        }
      )
      .map((entry, index) => ({
        id: typeof entry.id === 'string' && entry.id ? entry.id : `link-${index}-${Date.now()}`,
        label: typeof entry.label === 'string' ? entry.label : '',
        url: typeof entry.url === 'string' ? entry.url : '',
        icon: typeof entry.icon === 'string' ? entry.icon : undefined,
        showLabel: entry.showLabel === true ? true : undefined,
      }));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value)
      .map(([key, value], index) => ({
        id: `legacy-${key}-${index}`,
        label: key,
        url: value as string,
        icon: key,
      }));
  }
  return [];
};
