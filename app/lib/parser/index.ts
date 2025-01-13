import JSZip from 'jszip';

import { type ReportInfo } from './types';

import { withError } from '@/app/lib/withError';

export * from './types';

export const parse = async (html: string): Promise<ReportInfo> => {
  const base64Prefix = 'data:application/zip;base64,';
  const start = html.indexOf('window.playwrightReportBase64 = "') + 'window.playwrightReportBase64 = "'.length;
  const end = html.indexOf('";', start);
  const base64String = html.substring(start, end).trim().replace(base64Prefix, '');

  if (!base64String) {
    throw Error('[report parser] no data found in the html report');
  }

  const zipData = Buffer.from(base64String, 'base64');

  const { result: zip, error } = await withError(JSZip.loadAsync(zipData));

  if (error) {
    throw Error(`[report parser] failed to load zip file: ${error.message}`);
  }

  if (!zip) {
    throw Error('[report parser] parsed report data is empty');
  }

  const reportFile = zip.file('report.json');

  if (!reportFile) {
    throw Error('[report parser] no report.json file found in the zip');
  }

  const reportJson = await reportFile.async('string');

  return JSON.parse(reportJson);
};

export const parseHtmlReport = async (html: string) => {
  try {
    return await parse(html);
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e.message);
    }

    return null;
  }
};
