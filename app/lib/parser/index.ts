import JSZip from 'jszip';

import { type ReportInfo } from './types';

import { withError } from '@/app/lib/withError';

export * from './types';

/**
 *
 * @param html HTML string of the Playwright report
 * @description Parses the HTML report to extract the base64 encoded report data, decodes it
 * There are two possible formats (at the moment):
 * @example <script>window.playwrightReportBase64 = "...";</script>
 * @example <script id="playwrightReportBase64" type="application/zip">"..."</script>
 * @returns
 */

export const parse = async (html: string): Promise<ReportInfo> => {
  const base64Prefix = 'data:application/zip;base64,';
  const pattern = new RegExp(`${base64Prefix}([^";\\s]+)(?=[";\\s]|$)`);
  const matches = RegExp(pattern).exec(html);
  const match = matches?.at(0) ?? '';
  const base64String = match.replace(base64Prefix, '').replace('</script>', '').trim();

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
