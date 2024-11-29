import { REPORTS_BUCKET } from './constants';

export const isUUID = (uuid?: string): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid ?? '');
};

export const getFileReportID = (filePath: string): string => {
  const parts = filePath.split(REPORTS_BUCKET).pop()?.split('/') ?? [];

  const noProjectName = isUUID(parts?.at(1));

  const reportIdIndex = noProjectName ? 1 : 2;

  return parts?.at(reportIdIndex) ?? '';
};
