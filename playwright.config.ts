import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['blob', { outputFile: 'test-results/blob.zip' }],
    [
      '@cyborgtests/reporter-playwright-reports-server',
      {
        enabled: process.env.CI === 'true',
        url: 'https://overwhelming-jsandye-cyborg-tests-d6a8367f.koyeb.app',
        reportPath: 'test-results/blob.zip',
        resultDetails: {
          testsType: 'API',
        },
      },
    ],
    ['list', { printSteps: true }],
  ],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      testMatch: /.*\.test\.ts/,
      use: {
        baseURL: 'http://localhost:3000',
        ...devices['Desktop Chrome'],
        extraHTTPHeaders: {
          ...(process.env.API_TOKEN ? { Authorization: process.env.API_TOKEN } : {}),
        },
      },
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      testMatch: /.*\.test\.ts/,
      use: {
        baseURL: 'http://localhost:3000',
        ...devices['Desktop Chrome'],
        extraHTTPHeaders: {
          ...(process.env.API_TOKEN ? { Authorization: process.env.API_TOKEN } : {}),
        },
      },
    },
  ],
  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/info',
    reuseExistingServer: !process.env.CI,
  },
});
