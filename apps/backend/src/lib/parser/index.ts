import type { ReportInfo } from '@playwright-reports/shared';
import { Open } from 'unzipper';
import { withError } from '../../lib/withError.js';
import { decodeReportZip } from './report-zip.js';

export const parse = async (html: string): Promise<ReportInfo> => {
  const zipData = decodeReportZip(html);

  if (!zipData) {
    throw Error('[report parser] no data found in the html report');
  }

  const { result: directory, error } = await withError(Open.buffer(zipData));

  if (error) {
    throw Error(`[report parser] failed to load zip file: ${error.message}`);
  }

  if (!directory) {
    throw Error('[report parser] parsed report data is empty');
  }

  const reportFile = directory.files.find((f) => f.path === 'report.json');

  if (!reportFile) {
    throw new Error('[report parser] no report.json file found in the zip');
  }

  const reportJson = (await reportFile.buffer()).toString('utf-8');

  return JSON.parse(reportJson);
};

export const parseHtmlReport = async (html: string) => {
  try {
    return await parse(html);
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(`[report parser] ${e.message}`);
    }

    return null;
  }
};
