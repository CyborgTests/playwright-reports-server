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
      '@cyborgtests/reporter-playwright-reports-server',
      {
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
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      testMatch: /.*\.test\.ts/,
      use: { baseURL: 'http://localhost:3000', ...devices['Desktop Chrome'] },
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      testMatch: /.*\.test\.ts/,
      use: { baseURL: 'http://localhost:3000', ...devices['Desktop Chrome'] },
    },
  ],
  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/info',
    reuseExistingServer: !process.env.CI,
  },
});
