export interface ParsedTestUrl {
  reportId: string;
  project?: string;
  isPlaywrightReport: boolean;
}

export function extractReportIdFromPath(filePath: string): string | undefined {
  const pathParts = filePath.split('/');
  const index = pathParts.indexOf('index.html');

  if (index > 0) {
    return pathParts[index - 1];
  }

  return undefined;
}

export function parsePlaywrightTestUrl(filePath: string): ParsedTestUrl {
  const reportId = extractReportIdFromPath(filePath);

  return {
    reportId: reportId || '',
    isPlaywrightReport: filePath.includes('/index.html') && !!reportId,
  };
}

/**
 * Check if a file path represents a Playwright report index.html
 */
export function isPlaywrightReport(filePath: string): boolean {
  return filePath.includes('/index.html') && extractReportIdFromPath(filePath) !== undefined;
}
