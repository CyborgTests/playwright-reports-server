import type { ClusterAnchor } from '@playwright-reports/shared';

export function describeGroupKind(
  kind: 'fixture' | 'selector' | 'frame' | 'signature' | 'unmatched'
): string {
  switch (kind) {
    case 'fixture':
      return 'Shared fixture failure';
    case 'selector':
      return 'Shared locator failure';
    case 'frame':
      return 'Shared failure location';
    case 'signature':
      return 'Shared error signature';
    case 'unmatched':
      return 'Isolated failure';
  }
}

export function renderAnchorInline(anchor: ClusterAnchor): string | null {
  switch (anchor.kind) {
    case 'fixture':
      return `shared fixture \`${anchor.phase}\` in \`${anchor.filePath}\` (verb=${anchor.verb})`;
    case 'selector':
      return `shared locator \`${anchor.selector}\` (verb=${anchor.verb})`;
    case 'frame':
      return `shared failure location \`${anchor.frame}\` (verb=${anchor.verb})`;
    case 'signature':
      return `shared error signature (verb=${anchor.verb})`;
    case 'unmatched':
      return `no shared fix target — failure is specific to test \`${anchor.testId}\``;
  }
}

export function renderTrendLabel(
  trend: 'newlyFailed' | 'stillFailing' | 'unknown' | undefined
): string {
  if (trend === 'newlyFailed') return ' — **newly failed since previous report**';
  if (trend === 'stillFailing') return ' — still failing from previous report';
  return '';
}
