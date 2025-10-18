import { SVGProps } from 'react';

import { type HeaderLinks } from '@/app/config/site';

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export interface JiraConfig {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
  projectKey?: string;
}

export interface SiteWhiteLabelConfig {
  title: string;
  headerLinks: HeaderLinks;
  logoPath: string;
  faviconPath: string;
  reporterPaths?: string[];
  authRequired?: boolean;
  cron?: {
    resultExpireDays?: number;
    resultExpireCronSchedule?: string;
    reportExpireDays?: number;
    reportExpireCronSchedule?: string;
  };
  jira?: JiraConfig;
}
