import { SiteWhiteLabelConfig } from '@/app/types';
import { defaultLinks } from '@/app/config/site';

export const defaultConfig: SiteWhiteLabelConfig = {
  title: 'Cyborg Tests',
  headerLinks: defaultLinks,
  logoPath: '/logo.svg',
  faviconPath: '/favicon.ico',
  reporterPaths: [],
  cron: {
    resultExpireDays: Number(process.env.RESULT_EXPIRE_DAYS) ?? 30,
    resultExpireCronSchedule: process.env.RESULT_EXPIRE_CRON_SCHEDULE ?? '0 2 * * *',
    reportExpireDays: Number(process.env.REPORT_EXPIRE_DAYS) ?? 90,
    reportExpireCronSchedule: process.env.REPORT_EXPIRE_CRON_SCHEDULE ?? '0 3 * * *',
  },
  jira: {
    baseUrl: process.env.JIRA_BASE_URL ?? '',
    email: process.env.JIRA_EMAIL ?? '',
    apiToken: process.env.JIRA_API_TOKEN ?? '',
    projectKey: process.env.JIRA_PROJECT_KEY ?? '',
  },
};

export const noConfigErr = 'no config';

export const isConfigValid = (config: any): config is SiteWhiteLabelConfig => {
  return (
    !!config &&
    typeof config === 'object' &&
    'title' in config &&
    'headerLinks' in config &&
    'logoPath' in config &&
    'faviconPath' in config
  );
};
