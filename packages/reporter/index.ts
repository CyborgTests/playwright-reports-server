import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig, Reporter } from '@playwright/test/reporter';
import { ReportServerClient } from './client.js';
import { DEFAULT_OPTIONS } from './config.js';
import type { PublicReporterOptions, ReporterOptions } from './types.js';

/*
Usage in playwright.config.ts:
reporter: [
  ['@playwright-reports/reporter', {
    url: 'http://localhost:3000/',
    resultDetails: { browser: 'chromium', foo: 'bar' },
    triggerReportGeneration: true,
  }]
]
*/

const getUsername = (): string => {
  const username = process.env.QA_USERNAME || '';
  if (username) return username;
  try {
    const gitUser = execSync('git config user.name', { encoding: 'utf8' }).trim();
    if (gitUser) return gitUser;
  } catch {
    /* ignore */
  }
  return '';
};

class ReporterPlaywrightReportsServer implements Reporter {
  rpOptions: ReporterOptions;
  pwConfig!: FullConfig;
  blobPath!: string;
  blobName!: string;
  client!: ReportServerClient;

  constructor(options: PublicReporterOptions) {
    this.rpOptions = { ...DEFAULT_OPTIONS, ...options };
    if (this.rpOptions.enabled === false) {
      return;
    }
    if (!this.rpOptions.reportPath) {
      throw new Error(
        '[ReporterPlaywrightReportsServer] reportPath is required, cannot run without it'
      );
    }
    if (!this.rpOptions.url) {
      throw new Error('[ReporterPlaywrightReportsServer] url is required, cannot run without it');
    }
    this.blobPath = path.join(process.cwd(), this.rpOptions.reportPath);
    this.blobName = path.basename(this.blobPath);
    this.client = new ReportServerClient({
      url: this.rpOptions.url,
      token: this.rpOptions.token,
      requestTimeout: this.rpOptions.requestTimeout,
      blobUploadTimeout: this.rpOptions.blobUploadTimeout,
    });
  }

  async onBegin(config: FullConfig) {
    if (this.rpOptions.enabled === false) {
      return;
    }

    if (this.rpOptions.skipQuarantinedTests) {
      const tests = await this.client.getQuarantinedTests(this.rpOptions.resultDetails.project);
      console.debug(`[ReporterPlaywrightReportsServer] got ${tests.length} quarantined tests`);
      try {
        await fs.writeFile(
          this.rpOptions.quarantineFilePath,
          JSON.stringify(tests, null, 2),
          'utf-8'
        );
        console.debug(
          `[ReporterPlaywrightReportsServer] quarantine file written to ${this.rpOptions.quarantineFilePath}`
        );
      } catch (e) {
        console.error(
          `[ReporterPlaywrightReportsServer] failed to write quarantine file:`,
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    this.pwConfig = config;
  }

  async onEnd() {
    if (this.rpOptions.enabled === false) {
      return;
    }

    const details: Record<string, string> = Object.fromEntries(
      Object.entries(this.rpOptions.resultDetails).map(([k, v]) => [k, v ?? ''])
    );
    if (!details.username) {
      const u = getUsername();
      if (u) details.username = u;
    }
    const version = this.pwConfig.version ?? '';
    const shard = this.pwConfig.shard;
    if (shard) {
      details.shardCurrent = String(shard.current);
      details.shardTotal = String(shard.total);
    }
    details.playwrightVersion = version;
    details.triggerReportGeneration = String(this.rpOptions.triggerReportGeneration ?? false);

    const resultResponse = await this.client.uploadBlob(this.blobPath, {
      fileName: this.blobName || 'blob.zip',
      fields: details,
      logProgress: !!this.rpOptions.logProgress,
    });

    console.debug('[ReporterPlaywrightReportsServer] blob result uploaded:', resultResponse);

    const baseUrl = this.rpOptions.url.endsWith('/')
      ? this.rpOptions.url.slice(0, -1)
      : this.rpOptions.url;

    if (resultResponse.generatedReport?.reportUrl) {
      console.log(
        `[ReporterPlaywrightReportsServer] 🎭 HTML Report is available at: ${baseUrl}${resultResponse.generatedReport.reportUrl}`
      );
    }
  }
}

export { expect, test } from './quarantineCheck.js';
export default ReporterPlaywrightReportsServer;
