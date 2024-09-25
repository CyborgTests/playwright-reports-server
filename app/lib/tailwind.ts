import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { ReportTestOutcome } from './parser';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function testStatusToColor(outcome?: ReportTestOutcome) {
  const outcomes = {
    [ReportTestOutcome.Expected]: {
      title: 'Passed',
      color: 'text-success-500',
    },
    [ReportTestOutcome.Unexpected]: {
      title: 'Failed',
      color: 'text-danger-500',
    },
    [ReportTestOutcome.Flaky]: {
      title: 'Flaky',
      color: 'text-warning-500',
    },
    [ReportTestOutcome.Skipped]: {
      title: 'Skipped',
      color: 'text-gray-500',
    },
    unknown: {
      title: 'N/A',
      color: 'text-gray-200',
    },
  };

  return outcome ? outcomes[outcome] : outcomes.unknown;
}
