import type { ReportTestOutcome } from '@playwright-reports/shared';

export interface TestStatusColor {
  title: string;
  color: string;
  colorName: 'success' | 'danger' | 'warning' | 'default';
}

export function testStatusToColor(outcome: ReportTestOutcome): TestStatusColor {
  switch (outcome) {
    case 'passed':
    case 'expected':
      return {
        title: '✅ Passed',
        color: 'text-[hsl(var(--success))]',
        colorName: 'success',
      };
    case 'failed':
    case 'unexpected':
      return {
        title: '❌ Failed',
        color: 'text-[hsl(var(--failure))]',
        colorName: 'danger',
      };
    case 'skipped':
      return {
        title: '⏭️ Skipped',
        color: 'text-[hsl(var(--skipped))]',
        colorName: 'warning',
      };
    case 'flaky':
      return {
        title: '🔄 Flaky',
        color: 'text-[hsl(var(--flaky))]',
        colorName: 'warning',
      };
    default:
      return {
        title: '❓ Unknown',
        color: 'text-[hsl(var(--muted-foreground))]',
        colorName: 'default',
      };
  }
}
