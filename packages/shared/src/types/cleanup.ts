export const ATTACHMENT_CLEANUP_KINDS = ['trace', 'video', 'screenshot'] as const;

export type AttachmentCleanupKind = (typeof ATTACHMENT_CLEANUP_KINDS)[number];

export type CleanupKind = AttachmentCleanupKind | 'reportFiles' | 'reports' | 'results';

export interface CleanupConfirmation {
  confirmedAt: string;
  confirmedDays: number;
}

export type CleanupConfirmations = Partial<Record<CleanupKind, CleanupConfirmation>>;

export interface CronConfig extends Partial<Record<CleanupDaysKey, number>> {
  resultExpireCronSchedule?: string;
  reportExpireCronSchedule?: string;
  cleanupConfirmations?: CleanupConfirmations;
}

const RULE_SOURCE = {
  trace: {
    label: 'Traces',
    description: 'Traces, dom snapshots, and the trace viewer app folder',
    scheduleKey: 'reportExpireCronSchedule',
    daysKey: 'traceExpireDays',
    containedBy: 'reportFiles',
  },
  video: {
    label: 'Videos',
    description: 'Failure videos',
    scheduleKey: 'reportExpireCronSchedule',
    daysKey: 'videoExpireDays',
    containedBy: 'reportFiles',
  },
  screenshot: {
    label: 'Screenshots',
    description: 'Failure screenshots',
    scheduleKey: 'reportExpireCronSchedule',
    daysKey: 'screenshotExpireDays',
    containedBy: 'reportFiles',
  },
  reportFiles: {
    label: 'Report folder',
    description: 'The whole report folder',
    scheduleKey: 'reportExpireCronSchedule',
    daysKey: 'reportFilesExpireDays',
    containedBy: 'reports',
  },
  reports: {
    label: 'Report + history',
    description: 'Entire report + database records',
    scheduleKey: 'reportExpireCronSchedule',
    daysKey: 'reportExpireDays',
  },
  results: {
    label: 'Results',
    description: 'Result blobs',
    scheduleKey: 'resultExpireCronSchedule',
    daysKey: 'resultExpireDays',
  },
} as const satisfies Record<
  CleanupKind,
  {
    label: string;
    description: string;
    daysKey: `${string}ExpireDays`;
    scheduleKey: `${string}CronSchedule`;
    containedBy?: CleanupKind;
  }
>;

export type CleanupDaysKey = (typeof RULE_SOURCE)[CleanupKind]['daysKey'];
export type CleanupScheduleKey = (typeof RULE_SOURCE)[CleanupKind]['scheduleKey'];

interface CleanupRule {
  label: string;
  description: string;
  daysKey: CleanupDaysKey;
  scheduleKey: CleanupScheduleKey;
  containedBy?: CleanupKind;
}

export const CLEANUP_RULES: Record<CleanupKind, CleanupRule> = RULE_SOURCE;

export const CLEANUP_KINDS = Object.keys(CLEANUP_RULES) as readonly CleanupKind[];

export const CLEANUP_DAYS_KEYS: readonly CleanupDaysKey[] = CLEANUP_KINDS.map(
  (kind) => CLEANUP_RULES[kind].daysKey
);

export const CLEANUP_SCHEDULE_KEYS: readonly CleanupScheduleKey[] = [
  ...new Set(CLEANUP_KINDS.map((kind) => CLEANUP_RULES[kind].scheduleKey)),
];

export const DEFAULT_CLEANUP_SCHEDULES: Record<CleanupScheduleKey, string> = {
  reportExpireCronSchedule: '44 4 * * *',
  resultExpireCronSchedule: '33 3 * * *',
};

export function cleanupDays(cron: CronConfig, kind: CleanupKind): number | undefined {
  const value = cron[CLEANUP_RULES[kind].daysKey];
  return typeof value === 'number' && value > 0 ? value : undefined;
}

export function isCleanupConfirmed(cron: CronConfig, kind: CleanupKind): boolean {
  const days = cleanupDays(cron, kind);
  if (days === undefined) return false;
  const confirmed = cron.cleanupConfirmations?.[kind]?.confirmedDays;
  return confirmed !== undefined && days >= confirmed;
}

export interface CleanupEstimate {
  kind: CleanupKind;
  days?: number;
  affectedRows: number;
  items?: number;
  bytes?: number;
  unmeasured?: number;
  testRuns?: number;
  analyses?: number;
}

export interface CleanupWindowIssue {
  field: CleanupDaysKey;
  message: string;
  suggestedDays: number;
}

export function validateCleanupWindows(cron: CronConfig): CleanupWindowIssue[] {
  const issues: CleanupWindowIssue[] = [];

  for (const kind of CLEANUP_KINDS) {
    const rule = CLEANUP_RULES[kind];
    const days = cleanupDays(cron, kind);
    if (days === undefined) continue;

    let limit: number | undefined;
    let limitKind: CleanupKind | undefined;
    for (
      let container = rule.containedBy;
      container;
      container = CLEANUP_RULES[container].containedBy
    ) {
      const containerDays = cleanupDays(cron, container);
      if (containerDays !== undefined && (limit === undefined || containerDays < limit)) {
        limit = containerDays;
        limitKind = container;
      }
    }

    if (limit !== undefined && limitKind && days > limit) {
      issues.push({
        field: rule.daysKey,
        message: `${rule.label} cannot outlive ${CLEANUP_RULES[limitKind].label} (${limit} days).`,
        suggestedDays: limit,
      });
    }
  }

  return issues;
}
