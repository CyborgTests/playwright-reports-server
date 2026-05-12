import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['blob', { outputFile: 'test-results/blob.zip' }],
    [
      '@playwright-reports/reporter',
      {
        enabled: process.env.CI === 'true',
        url: 'https://demo.shelex.dev',
        reportPath: 'test-results/blob.zip',
        resultDetails: {
          testsType: 'API',
          project: 'Backend Tests',
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
      use: { baseURL: 'http://localhost:3001', ...devices['Desktop Chrome'] },
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
