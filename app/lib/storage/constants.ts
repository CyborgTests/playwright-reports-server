import path from 'node:path';

export const DATA_PATH = 'data';
export const RESULTS_PATH = 'results';
export const REPORTS_PATH = 'reports';
export const CONFIG_FILENAME = 'config.json';

export const APP_CONFIG_S3 = `${DATA_PATH}/${CONFIG_FILENAME}`;
export const RESULTS_BUCKET = `${DATA_PATH}/${RESULTS_PATH}`;
export const REPORTS_BUCKET = `${DATA_PATH}/${REPORTS_PATH}`;

const CWD = process.cwd();

export const DATA_FOLDER = path.join(CWD, DATA_PATH);
export const APP_CONFIG = path.join(DATA_FOLDER, CONFIG_FILENAME);
export const PW_CONFIG = path.join(CWD, 'playwright.config.ts');
export const TMP_FOLDER = path.join(CWD, '.tmp');
export const RESULTS_FOLDER = path.join(DATA_FOLDER, RESULTS_PATH);
export const REPORTS_FOLDER = path.join(DATA_FOLDER, REPORTS_PATH);

export const REPORT_METADATA_FILE = 'report-server-metadata.json';

export const DEFAULT_STREAM_CHUNK_SIZE = 512 * 1024; // 512KB
