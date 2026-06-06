export type ProjectFilter =
  | { mode: 'all' }
  | { mode: 'project'; name: string }
  | { mode: 'regex'; pattern: string };

type NotificationEvent = 'report_uploaded';

export const EVENT_CONDITIONS = [
  'always',
  'has_failures',
  'pass_rate_below_100',
  'recovered_to_clean',
  'recovered_no_hard_failures',
] as const;

export type EventCondition = (typeof EVENT_CONDITIONS)[number];

export interface EventRule {
  id: string;
  kind: 'event';
  enabled?: boolean;
  event: NotificationEvent;
  condition: EventCondition;
  projectFilter: ProjectFilter;
  template?: ChannelTemplate;
}

export const SCHEDULE_CONDITIONS = ['always', 'all_clean', 'no_hard_failures'] as const;

export type ScheduleCondition = (typeof SCHEDULE_CONDITIONS)[number];

export type ScheduleCadence = 'daily' | 'weekly' | { cron: string };

export type ScheduleWindow = 'last_24h' | 'last_7d' | 'last_14d' | 'since_last_send';

export interface ScheduleRule {
  id: string;
  kind: 'schedule';
  enabled?: boolean;
  cadence: ScheduleCadence;
  sendAt: string;
  window: ScheduleWindow;
  condition: ScheduleCondition;
  projectFilter: ProjectFilter;
  template?: ChannelTemplate;
}

export type NotificationRule = EventRule | ScheduleRule;

export type SlackBlock =
  | { type: 'header'; text: string }
  | { type: 'section'; text: string }
  | { type: 'divider' }
  | { type: 'context'; text: string }
  | { type: 'actions'; buttons: Array<{ label: string; url: string }> }
  | { type: 'image'; url: string; altText?: string };

export type ChannelTemplate =
  | { provider: 'slack'; blocks: SlackBlock[] }
  | { provider: 'webhook'; bodyJson: string };

export type ChannelType = 'slack' | 'webhook';

export interface SlackChannelConfig {
  webhookUrl: string;
}

export interface WebhookChannelConfig {
  url: string;
  headers?: Record<string, string>;
  secretHmacKey?: string;
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: SlackChannelConfig | WebhookChannelConfig;
  rules: NotificationRule[];
}

export interface NotificationsConfig {
  enabled: boolean;
  channels: NotificationChannel[];
}

export type NotificationDeliveryStatus = 'success' | 'failed' | 'skipped';

export type NotificationSkipReason =
  | 'circuit_open'
  | 'no_activity'
  | 'condition_unmet'
  | 'duplicate'
  | 'empty_render';

export type NotificationSource = 'live' | 'test';

export const SECRET_MASK = '••••••';
export function isOpaqueMaskSentinel(value: string | undefined): boolean {
  return value === SECRET_MASK;
}

export function isUrlMaskSentinel(value: string | undefined): boolean {
  if (!value) return false;
  if (value === SECRET_MASK) return true;
  return value.endsWith(`…${SECRET_MASK}`);
}

export interface NotificationLogEntry {
  id: string;
  channelId: string;
  channelType: ChannelType;
  ruleId: string;
  ruleKind: 'event' | 'schedule';
  event: string;
  condition: string;
  status: NotificationDeliveryStatus;
  skipReason?: NotificationSkipReason | null;
  httpStatus?: number | null;
  error?: string | null;
  attempt: number;
  source: NotificationSource;
  createdAt: number;
}
