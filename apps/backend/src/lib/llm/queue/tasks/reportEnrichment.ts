import fs from 'node:fs/promises';
import path from 'node:path';
import {
  extractFailureEvidence,
  type FailureEvidence,
} from '../../../parser/failure-extraction.js';
import { parseHtmlReport } from '../../../parser/index.js';
import { REPORTS_FOLDER } from '../../../storage/constants.js';
import type { AttemptSummary, FailureDetailsForPrompt } from '../../prompts/index.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function readImageAttachment(
  reportId: string,
  att: { name: string; path: string; contentType: string }
): Promise<{ data: string; mediaType: string; source: string } | null> {
  if (!att.contentType?.startsWith('image/')) return null;
  try {
    const fullPath = path.join(REPORTS_FOLDER, reportId, att.path);
    const stat = await fs.stat(fullPath);
    if (stat.size > MAX_IMAGE_BYTES) {
      console.warn(
        `[llmQueue] image ${att.path} skipped (${stat.size}B > ${MAX_IMAGE_BYTES}B cap)`
      );
      return null;
    }
    const buf = await fs.readFile(fullPath);
    return { data: buf.toString('base64'), mediaType: att.contentType, source: att.path };
  } catch (err) {
    console.warn(
      `[llmQueue] failed to read image ${att.path}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export function isEvidenceStale(evidence: FailureEvidence | undefined): boolean {
  if (!evidence) return true;
  if (
    typeof evidence.pageSnapshot === 'string' &&
    evidence.pageSnapshot.endsWith('... (truncated)')
  ) {
    return true;
  }
  return !(
    evidence.testSourceFrame ||
    evidence.stepTree ||
    evidence.stdout ||
    evidence.stderr ||
    evidence.testMeta ||
    evidence.gitCommit ||
    evidence.ciBuild ||
    evidence.gitDiff
  );
}

export function areAttemptsStale(attempts: AttemptSummary[] | undefined): boolean {
  if (!attempts || attempts.length === 0) return true;
  return attempts.every((a) => !a.status || a.status === 'unknown');
}

export async function enrichEnvironmentFromReport(
  details: FailureDetailsForPrompt,
  reportId: string
): Promise<void> {
  if (!details.evidence?.environment) return;
  if (details.evidence.environment.playwrightVersion) return;
  try {
    const { reportDb } = await import('../../../service/db/reports.sqlite.js');
    const reportRow = reportDb.getByID(reportId);
    const pwVersion = (reportRow?.metadata as { playwrightVersion?: string } | undefined)
      ?.playwrightVersion;
    if (pwVersion) {
      details.evidence = {
        ...details.evidence,
        environment: { ...details.evidence.environment, playwrightVersion: pwVersion },
      };
    }
  } catch {
    // ignore — environment is best-effort
  }
}

export async function extractDetailsFromReport(
  reportId: string,
  testId: string
): Promise<FailureDetailsForPrompt | null> {
  try {
    const reportDir = path.join(REPORTS_FOLDER, reportId);
    const htmlPath = path.join(reportDir, 'index.html');
    const html = await fs.readFile(htmlPath, 'utf-8');
    const reportInfo = await parseHtmlReport(html);

    if (!reportInfo?.files) return null;

    for (const file of reportInfo.files) {
      if (!file.tests) continue;
      for (const test of file.tests) {
        if (test.testId !== testId) continue;

        const allAttachments: Array<{ name: string; path: string; contentType: string }> = [];
        const attempts: Array<{
          attempt: number;
          status: string;
          message?: string;
          durationMs?: number;
        }> = [];

        let firstFailedResult:
          | {
              status?: string;
              message?: string;
              duration?: number;
              attachments?: Array<{ name: string; contentType: string; path: string }>;
            }
          | undefined;

        if (test.results) {
          for (let i = 0; i < test.results.length; i++) {
            const result = test.results[i] as {
              status?: string;
              message?: string;
              duration?: number;
              attachments?: Array<{ name: string; contentType: string; path: string }>;
            };

            const summary =
              result.status === 'passed'
                ? undefined
                : (result.message ?? '').replace(/\s+/g, ' ').trim().substring(0, 300) || undefined;
            const resolvedStatus = result.status || test.outcome || 'unknown';
            attempts.push({
              attempt: i + 1,
              status: resolvedStatus,
              message: summary,
              durationMs: typeof result.duration === 'number' ? result.duration : undefined,
            });

            if (result.status !== 'passed' && !firstFailedResult) {
              firstFailedResult = result;
            }

            if (result.attachments) {
              for (const att of result.attachments) {
                allAttachments.push({
                  name: att.name,
                  path: att.path,
                  contentType: att.contentType,
                });
              }
            }
          }
        }

        if (test.attachments) {
          for (const att of test.attachments) {
            allAttachments.push({
              name: att.name,
              path: att.path,
              contentType: att.contentType,
            });
          }
        }

        const evidence = await extractFailureEvidence(
          reportId,
          { testId: test.testId, title: test.title, outcome: test.outcome },
          firstFailedResult ?? { status: test.outcome, attachments: allAttachments }
        );

        return {
          message: evidence.errorMessage,
          stackTrace: evidence.stackTrace,
          testTitle: test.title,
          filePath: file.fileName || file.fileId,
          location: test.location,
          attachments: allAttachments,
          attempt: 1,
          status: test.outcome || 'failed',
          attempts: attempts.length > 0 ? attempts : undefined,
          evidence,
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`[llmQueue] Failed to extract details from report ${reportId}:`, error);
    return null;
  }
}

export function buildRunContextFromReport(
  report: Record<string, unknown> & { createdAt?: string | Date }
): import('../../prompts/index.js').ReportSummaryRunContext | undefined {
  const gitCommitRaw = report.gitCommit as
    | { hash?: string; shortHash?: string; branch?: string; subject?: string }
    | undefined;
  const ciRaw = report.ci as
    | { buildHref?: string; commitHref?: string; commitHash?: string }
    | undefined;
  const playwrightVersion =
    typeof report.playwrightVersion === 'string' ? report.playwrightVersion : undefined;
  const actualWorkers = typeof report.actualWorkers === 'number' ? report.actualWorkers : undefined;
  const createdAt =
    report.createdAt instanceof Date
      ? report.createdAt.toISOString()
      : typeof report.createdAt === 'string'
        ? report.createdAt
        : undefined;

  const gitCommit =
    gitCommitRaw &&
    (gitCommitRaw.hash || gitCommitRaw.shortHash || gitCommitRaw.branch || gitCommitRaw.subject)
      ? {
          hash: gitCommitRaw.hash,
          shortHash: gitCommitRaw.shortHash,
          branch: gitCommitRaw.branch,
          subject: gitCommitRaw.subject,
        }
      : undefined;
  const ci =
    ciRaw && (ciRaw.buildHref || ciRaw.commitHref || ciRaw.commitHash)
      ? { buildHref: ciRaw.buildHref, commitHref: ciRaw.commitHref, commitHash: ciRaw.commitHash }
      : undefined;

  if (!gitCommit && !ci && !playwrightVersion && actualWorkers === undefined && !createdAt) {
    return undefined;
  }
  return { gitCommit, ci, playwrightVersion, actualWorkers, createdAt };
}
