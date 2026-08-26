import { CLEANUP_RULES } from '@playwright-reports/shared';
import { type ArtifactState, removedAttachmentKinds } from './service/db/index.js';
import { attachmentKindOf } from './storage/attachments.js';

interface Notice {
  emoji: string;
  title: string;
  message: string;
  hint: string;
}

export function renderNoticePage({ emoji, title, message, hint }: Notice): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #1f2937, #0b0f17); color: #e5e7eb; padding: 24px; }
  .card { max-width: 460px; text-align: center; }
  .emoji { font-size: 72px; line-height: 1; margin-bottom: 16px; }
  h1 { font-size: 24px; margin: 0 0 8px; font-weight: 700; }
  p { margin: 0 0 8px; color: #9ca3af; font-size: 15px; line-height: 1.5; }
  .hint { margin-top: 20px; font-size: 13px; color: #6b7280; }
  a { color: #60a5fa; text-decoration: none; }
</style>
</head>
<body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="hint">${hint}</p>
  </div>
</body>
</html>`;
}

interface ServeMiss {
  status: 410 | 404 | 502;
  notice: Notice;
  error: string;
}

const TRACE_DIRECTORY = /(^|\/)trace\//i;

export const storageUnreachable = (detail: string): ServeMiss => ({
  status: 502,
  error: `Could not read file: ${detail}`,
  notice: {
    emoji: '🛑',
    title: 'Storage is unreachable',
    message: 'The report store did not respond, so this file could not be read.',
    hint: 'This is usually temporary - try again shortly.',
  },
});

export function classifyServeMiss(
  targetPath: string,
  state: ArtifactState | undefined,
  fallbackError: string,
  viaShare = false
): ServeMiss {
  const [reportId, ...rest] = targetPath.split('/');
  const notFound: ServeMiss = {
    status: 404,
    error: fallbackError,
    notice: {
      emoji: '🔍',
      title: 'File not found',
      message: 'This file is not part of the report.',
      hint: 'Check the link, or open the report from the reports list.',
    },
  };

  const statsHint = viaShare
    ? 'Ask whoever sent it for a fresh link.'
    : `The report's stats and history are still available - <a href="/report/${encodeURIComponent(reportId)}">view them here</a>.`;

  if (rest.length === 0) return notFound;

  if (!state) {
    return {
      status: 404,
      error: 'Report not found',
      notice: {
        emoji: '🕳️',
        title: 'This report no longer exists',
        message: 'It was deleted, along with its run history.',
        hint: 'Check <a href="/reports">the report list</a> for a newer run.',
      },
    };
  }

  if (state.artifactsMissingAt) {
    return {
      status: 410,
      error: 'Report files deleted',
      notice: {
        emoji: '🧹',
        title: 'Report files were deleted',
        message: 'Retention removed this report’s files. Its stats were kept.',
        hint: statsHint,
      },
    };
  }

  const expired = (label: string) => ({
    status: 410 as const,
    error: `${label} deleted`,
    notice: {
      emoji: '🧹',
      title: `${label} were deleted`,
      message: `Retention removed the ${label.toLowerCase()} for this report. The rest of the report still opens.`,
      hint: statsHint,
    },
  });

  const inTraceDirectory = TRACE_DIRECTORY.test(targetPath);
  const kind = inTraceDirectory
    ? 'trace'
    : /(^|\/)data\//i.test(targetPath)
      ? attachmentKindOf(targetPath)
      : null;
  if (kind && removedAttachmentKinds(state).includes(kind)) {
    return expired(CLEANUP_RULES[kind].label);
  }

  return { ...notFound, notice: { ...notFound.notice, hint: statsHint } };
}
