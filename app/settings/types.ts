export interface ServerConfig {
  title?: string;
  headerLinks?: Record<string, string>;
  logoPath?: string;
  faviconPath?: string;
  reporterPaths?: string[];
  cron?: {
    resultExpireDays?: number;
    resultExpireCronSchedule?: string;
    reportExpireDays?: number;
    reportExpireCronSchedule?: string;
  };
  jira?: {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    projectKey?: string;
  };
}

export interface JiraConfig {
  configured: boolean;
  baseUrl?: string;
  defaultProjectKey?: string;
  issueTypes?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  error?: string;
}
