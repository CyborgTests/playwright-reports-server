import { loadEnvFile } from 'node:process';
try { loadEnvFile() } catch {
  console.info('No .env file found, skipping loading environment variables from file.');
}

import { BACKEND_URL, FRONTEND_URL } from './tests/src/environment';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['blob', { outputFile: 'test-results/blob.zip' }],
    [
      '@cyborgtests/reporter',
      {
        enabled: process.env.CI === 'true',
        url: 'https://demo-playwright-reports-server.koyeb.app',
        reportPath: 'test-results/blob.zip',
        resultDetails: {
          testsType: process.env.TEST_TYPE ?? 'unknown',
          project: 'CyborgTestsServer'
        },
      },
    ],
    ['list', { printSteps: true }],
  ],
  use: {
    trace: 'on-first-retry',
    headless: process.env.CI === 'true',
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      testMatch: /.*\.test\.ts/,
      use: { baseURL: BACKEND_URL, ...devices['Desktop Chrome'] },
    },
  {
      name: 'e2e',
      testDir: './tests/e2e',
      testMatch: /.*\.test\.ts/,
      use: { baseURL: BACKEND_URL, ...devices['Desktop Chrome']},
    },
  ],
  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev:backend',
    url: 'http://localhost:3001/api/info',
    reuseExistingServer: true,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
