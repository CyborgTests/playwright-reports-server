import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { ReportTestOutcome } from './parser';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OutcomeColors {
  Success = 'success',
  Primary = 'primary',
  Danger = 'danger',
  Warning = 'warning',
  Default = 'default',
}

export function testStatusToColor(outcome?: ReportTestOutcome): {
  title: string;
  colorName: OutcomeColors;
  color: string;
} {
  const outcomes = {
    [ReportTestOutcome.Expected]: {
      title: 'Passed',
      colorName: OutcomeColors.Success,
      color: 'text-success-500',
    },
    [ReportTestOutcome.Unexpected]: {
      title: 'Failed',
      colorName: OutcomeColors.Danger,
      color: 'text-danger-500',
    },
    [ReportTestOutcome.Flaky]: {
      title: 'Flaky',
      colorName: OutcomeColors.Warning,
      color: 'text-warning-500',
    },
    [ReportTestOutcome.Skipped]: {
      title: 'Skipped',
      colorName: OutcomeColors.Default,
      color: 'text-gray-500',
    },
    unknown: {
      title: 'N/A',
      colorName: OutcomeColors.Primary,
      color: 'text-gray-200',
    },
  };

  return outcome ? outcomes[outcome] : outcomes.unknown;
}
