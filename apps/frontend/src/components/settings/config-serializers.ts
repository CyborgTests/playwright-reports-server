import type { ServerConfig } from '@playwright-reports/shared';
import type { EditableSettingsSection } from './types';

export interface ServerSectionFiles {
  logoFile: File | null;
  faviconFile: File | null;
  pendingLinkIcons: Record<string, File>;
}

function serializeServer(
  fd: FormData,
  temp: ServerConfig,
  config: ServerConfig,
  files: ServerSectionFiles
): void {
  if ((temp.title ?? '') !== (config.title ?? '')) {
    fd.append('title', temp.title ?? '');
  }
  if ((temp.serverBaseUrl ?? '') !== (config.serverBaseUrl ?? '')) {
    fd.append('serverBaseUrl', temp.serverBaseUrl ?? '');
  }
  if (files.logoFile) {
    fd.append('logo', files.logoFile);
  } else if ((temp.logoPath ?? '') !== (config.logoPath ?? '')) {
    fd.append('logoPath', temp.logoPath ?? '');
  }
  if ((temp.logoInvertOnDark ?? true) !== (config.logoInvertOnDark ?? true)) {
    fd.append('logoInvertOnDark', (temp.logoInvertOnDark ?? true) ? 'true' : 'false');
  }
  if (files.faviconFile) {
    fd.append('favicon', files.faviconFile);
  } else if ((temp.faviconPath ?? '') !== (config.faviconPath ?? '')) {
    fd.append('faviconPath', temp.faviconPath ?? '');
  }

  const reporterPathsChanged =
    JSON.stringify(temp.reporterPaths ?? []) !== JSON.stringify(config.reporterPaths ?? []);
  if (reporterPathsChanged) {
    fd.append('reporterPaths', JSON.stringify(temp.reporterPaths ?? []));
  }

  const cleanHeaderLinks = (temp.headerLinks ?? []).map((link) => ({
    id: link.id,
    label: link.label ?? '',
    url: link.url ?? '',
    icon: link.icon,
    showLabel: link.showLabel === true ? true : undefined,
  }));
  const headerLinksChanged =
    JSON.stringify(cleanHeaderLinks) !== JSON.stringify(config.headerLinks ?? []) ||
    Object.keys(files.pendingLinkIcons).length > 0;
  if (headerLinksChanged) {
    fd.append('headerLinks', JSON.stringify(cleanHeaderLinks));
  }
  for (const [linkId, file] of Object.entries(files.pendingLinkIcons)) {
    fd.append(`linkIcon:${linkId}`, file);
  }
}

function serializeCron(fd: FormData, temp: ServerConfig): void {
  const cron = temp.cron ?? {};
  fd.append(
    'resultExpireDays',
    cron.resultExpireDays !== undefined ? cron.resultExpireDays.toString() : ''
  );
  fd.append('resultExpireCronSchedule', cron.resultExpireCronSchedule ?? '');
  fd.append(
    'reportExpireDays',
    cron.reportExpireDays !== undefined ? cron.reportExpireDays.toString() : ''
  );
  fd.append('reportExpireCronSchedule', cron.reportExpireCronSchedule ?? '');
}

function serializeTestManagement(fd: FormData, temp: ServerConfig): void {
  const tm = temp.testManagement;
  if (!tm) return;
  if (tm.quarantineThresholdPercentage !== undefined) {
    fd.append(
      'testManagementQuarantineThresholdPercentage',
      tm.quarantineThresholdPercentage.toString()
    );
  }
  if (tm.warningThresholdPercentage !== undefined) {
    fd.append('testManagementWarningThresholdPercentage', tm.warningThresholdPercentage.toString());
  }
  if (tm.autoQuarantineEnabled !== undefined) {
    fd.append('testManagementAutoQuarantineEnabled', tm.autoQuarantineEnabled.toString());
  }
  if (tm.flakinessMinRuns !== undefined) {
    fd.append('testManagementFlakinessMinRuns', tm.flakinessMinRuns.toString());
  }
  if (tm.flakinessEvaluationWindowDays !== undefined) {
    fd.append(
      'testManagementFlakinessEvaluationWindowDays',
      tm.flakinessEvaluationWindowDays.toString()
    );
  }
}

export function buildConfigFormData(
  section: Exclude<EditableSettingsSection, 'none'>,
  tempConfig: ServerConfig,
  config: ServerConfig,
  files: ServerSectionFiles
): FormData {
  const fd = new FormData();
  switch (section) {
    case 'server':
      serializeServer(fd, tempConfig, config, files);
      break;
    case 'cron':
      serializeCron(fd, tempConfig);
      break;
    case 'testManagement':
      serializeTestManagement(fd, tempConfig);
      break;
  }
  return fd;
}
