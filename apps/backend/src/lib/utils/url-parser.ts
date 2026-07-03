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
