import path from 'node:path';

export const DATA_PATH = 'data';
export const RESULTS_PATH = 'results';
export const REPORTS_PATH = 'reports';

export const RESULTS_BUCKET = `${DATA_PATH}/${RESULTS_PATH}`;
export const REPORTS_BUCKET = `${DATA_PATH}/${REPORTS_PATH}`;

export const CWD = process.cwd();

export const DATA_FOLDER = path.join(CWD, DATA_PATH);
export const PW_CONFIG = path.join(CWD, 'playwright.config.ts');
export const TMP_FOLDER = path.join(CWD, '.tmp');
export const RESULTS_FOLDER = path.join(DATA_FOLDER, RESULTS_PATH);
export const REPORTS_FOLDER = path.join(DATA_FOLDER, REPORTS_PATH);
export const PW_VERSIONS_FOLDER = path.join(DATA_FOLDER, 'playwright-versions');

export const DEFAULT_STREAM_CHUNK_SIZE = 512 * 1024; // 512KB

export function reportObjectKey(
  reportId: string,
  storagePath: string | null | undefined,
  subPath: string
): string {
  return `${REPORTS_BUCKET}/${storagePath || reportId}/${subPath}`;
}
