import type {
  NotificationChannel,
  NotificationRule,
  NotificationSkipReason,
} from '@playwright-reports/shared';

export interface DispatchResult {
  ok: boolean;
  httpStatus?: number;
  error?: string;
  attempts: number;
  skipReason?: NotificationSkipReason;
}

export interface DispatchInput {
  channel: NotificationChannel;
  rule: NotificationRule;
  context: Record<string, unknown>;
  allowlist: ReadonlySet<string>;
}
