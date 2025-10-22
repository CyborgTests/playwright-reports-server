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
  serverCache?: boolean;
  dataStorage?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  cron?: {
    resultExpireDays?: number;
    resultExpireCronSchedule?: string;
    reportExpireDays?: number;
    reportExpireCronSchedule?: string;
  };
  jira?: JiraConfig;
}

export interface EnvInfo {
  authRequired: boolean;
  serverCache: boolean | undefined;
  dataStorage: string | undefined;
  s3Endpoint: string | undefined;
  s3Bucket: string | undefined;
}
