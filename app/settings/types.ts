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
}
