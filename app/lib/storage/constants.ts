import path from 'node:path';

export const DATA_PATH = 'data';
export const RESULTS_PATH = 'results';
export const REPORTS_PATH = 'reports';

export const RESULTS_BUCKET = `${DATA_PATH}/${RESULTS_PATH}`;
export const REPORTS_BUCKET = `${DATA_PATH}/${REPORTS_PATH}`;

const CWD = process.cwd();

export const DATA_FOLDER = path.join(CWD, DATA_PATH);
export const PW_CONFIG = path.join(CWD, 'playwright.config.ts');
export const TMP_FOLDER = path.join(CWD, '.tmp');
export const RESULTS_FOLDER = path.join(DATA_FOLDER, RESULTS_PATH);
export const REPORTS_FOLDER = path.join(DATA_FOLDER, REPORTS_PATH);
