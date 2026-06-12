import type {
  ChannelTemplate,
  ChannelType,
  EventCondition,
  ScheduleCondition,
  SlackBlock,
} from './notifications.js';

const slackEventHasFailures: SlackBlock[] = [
  { type: 'header', text: '🔴 {{project}} - {{failed}} tests failed' },
  {
    type: 'section',
    text:
      '*Pass rate:* {{passRate}}%\n' +
      '*Passed:* {{passed}} *Failed:* {{failed}}  *Flaky:* {{flaky}} *Skipped:* {{skipped}}  *Duration:* {{duration}}',
  },
  { type: 'context', text: 'Report #{{displayNumber}} · {{timestamp}}' },
  {
    type: 'actions',
    buttons: [
      { label: 'View report', url: '{{reportUrl}}' },
      { label: 'Diff', url: '{{compareUrl}}' },
    ],
  },
];

const slackEventPassRateBelow100: SlackBlock[] = [
  { type: 'header', text: '🟡  {{project}} - {{passRate}}% pass rate' },
  {
    type: 'section',
    text:
      '*Pass rate:* {{passRate}}%\n' +
      '*Passed:* {{passed}} *Failed:* {{failed}}  *Flaky:* {{flaky}} *Skipped:* {{skipped}}  *Duration:* {{duration}}',
  },
  { type: 'context', text: 'Report #{{displayNumber}} · {{timestamp}}' },
  {
    type: 'actions',
    buttons: [
      { label: 'View report', url: '{{reportUrl}}' },
      { label: 'Diff', url: '{{compareUrl}}' },
    ],
  },
];

const slackEventRecoveredToClean: SlackBlock[] = [
  { type: 'header', text: '🎉 {{project}} - recovered' },
  {
    type: 'section',
    text:
      '*Passed:* {{passed}}/{{total}}\n' +
      '*Previous run:* {{prevPassRate}}% ({{prevFailed}} failed)',
  },
  { type: 'context', text: 'Report #{{displayNumber}} · {{timestamp}}' },
  {
    type: 'actions',
    buttons: [
      { label: 'View report', url: '{{reportUrl}}' },
      { label: 'Diff', url: '{{compareUrl}}' },
    ],
  },
];

const slackEventRecoveredNoHardFailures: SlackBlock[] = [
  { type: 'header', text: '🟢 {{project}} - {{total}} tests passed' },
  {
    type: 'section',
    text:
      '*Passed:* {{passed}}/{{total}}\n' +
      '*Flaky:* {{flaky}}\n' +
      '*Previous run:* {{prevFailed}} hard failures',
  },
  { type: 'context', text: 'Report #{{displayNumber}} · {{timestamp}}' },
  {
    type: 'actions',
    buttons: [
      { label: 'View report', url: '{{reportUrl}}' },
      { label: 'Diff', url: '{{compareUrl}}' },
    ],
  },
];

const slackEventAlways: SlackBlock[] = [
  { type: 'header', text: '📤 New report — {{project}}' },
  {
    type: 'section',
    text:
      '*Passed:* {{passed}}  *Failed:* {{failed}}  *Flaky:* {{flaky}}\n' +
      '*Pass rate:* {{passRate}}%  *Duration:* {{duration}}',
  },
  { type: 'context', text: 'Report #{{displayNumber}} · {{timestamp}}' },
  {
    type: 'actions',
    buttons: [{ label: 'View report', url: '{{reportUrl}}' }],
  },
];

const slackEventNewRegressions: SlackBlock[] = [
  { type: 'header', text: '🔻 New regressions — {{project}}' },
  {
    type: 'section',
    text: '*{{newRegressions}}* tests regressed in report #{{displayNumber}}.',
  },
  { type: 'context', text: '{{timestamp}}' },
  {
    type: 'actions',
    buttons: [{ label: 'View report', url: '{{reportUrl}}' }],
  },
];

const slackEventResolvedRegressions: SlackBlock[] = [
  { type: 'header', text: '✅ Regressions resolved — {{project}}' },
  {
    type: 'section',
    text: '*{{resolvedRegressions}}* tests recovered in report #{{displayNumber}}.',
  },
  { type: 'context', text: '{{timestamp}}' },
  {
    type: 'actions',
    buttons: [{ label: 'View report', url: '{{reportUrl}}' }],
  },
];

const slackScheduleAllClean: SlackBlock[] = [
  { type: 'header', text: '✅ Daily QA — {{project}}' },
  {
    type: 'section',
    text: '*{{reportCount}}* clean reports · *100%* pass rate\n' + '*Total tests:* {{totalPassed}}',
  },
  { type: 'context', text: '{{windowStart}} → {{windowEnd}}' },
  {
    type: 'actions',
    buttons: [{ label: 'Open dashboard', url: '{{dashboardUrl}}' }],
  },
];

const slackScheduleNoHardFailures: SlackBlock[] = [
  { type: 'header', text: '🟡 Daily QA — {{project}}' },
  {
    type: 'section',
    text:
      '*Reports:* {{reportCount}} · *0* hard failures\n' +
      '*Total tests:* {{totalPassed}} passed, {{totalFlaky}} flaky',
  },
  { type: 'context', text: '{{windowStart}} → {{windowEnd}}' },
  {
    type: 'actions',
    buttons: [{ label: 'Open dashboard', url: '{{dashboardUrl}}' }],
  },
];

const slackScheduleAlways: SlackBlock[] = [
  { type: 'header', text: '📊 Daily QA — {{project}}' },
  {
    type: 'section',
    text:
      '*Pass rate:* {{passRate}}%{{#passRateDelta}} ({{passRateDelta}}%){{/passRateDelta}}\n' +
      '*Reports:* {{reportCount}}  *Failures:* {{totalFailed}}  *Flaky:* {{totalFlaky}}',
  },
  { type: 'divider' },
  {
    type: 'section',
    text: '*Regressions:* {{regressionsCount}}  *Recoveries:* {{recoveriesCount}}',
  },
  { type: 'divider' },
  {
    type: 'section',
    text:
      '*Top failing tests:*\n' +
      '{{#topFailingTests}}• `{{title}}` — {{failureCount}}× ({{project}})\n{{/topFailingTests}}' +
      '{{^topFailingTests}}_No failing tests in this window._{{/topFailingTests}}',
  },
  { type: 'context', text: '{{windowStart}} → {{windowEnd}}' },
  {
    type: 'actions',
    buttons: [{ label: 'Open dashboard', url: '{{dashboardUrl}}' }],
  },
];

const WEBHOOK_EVENT_JSON = `{
  "event": "report_uploaded",
  "kind": "event",
  "project": "{{project}}",
  "timestamp": "{{timestamp}}",
  "report": {
    "id": "{{reportId}}",
    "displayNumber": "{{displayNumber}}",
    "url": "{{reportUrl}}",
    "passed": "{{passed}}",
    "failed": "{{failed}}",
    "flaky": "{{flaky}}",
    "skipped": "{{skipped}}",
    "total": "{{total}}",
    "passRate": "{{passRate}}",
    "duration": "{{duration}}"
  }
}`;

const WEBHOOK_SCHEDULE_JSON = `{
  "event": "schedule_summary",
  "kind": "schedule",
  "project": "{{project}}",
  "window": {
    "start": "{{windowStart}}",
    "end": "{{windowEnd}}",
    "label": "{{windowLabel}}",
    "cadence": "{{cadence}}"
  },
  "stats": {
    "reportCount": "{{reportCount}}",
    "passed": "{{totalPassed}}",
    "failed": "{{totalFailed}}",
    "flaky": "{{totalFlaky}}",
    "skipped": "{{totalSkipped}}",
    "passRate": "{{passRate}}",
    "regressions": "{{regressionsCount}}",
    "recoveries": "{{recoveriesCount}}"
  },
  "dashboardUrl": "{{dashboardUrl}}"
}`;

const SLACK_EVENT_BY_CONDITION: Record<EventCondition, SlackBlock[]> = {
  always: slackEventAlways,
  has_failures: slackEventHasFailures,
  pass_rate_below_100: slackEventPassRateBelow100,
  recovered_to_clean: slackEventRecoveredToClean,
  recovered_no_hard_failures: slackEventRecoveredNoHardFailures,
  new_regressions: slackEventNewRegressions,
  resolved_regressions: slackEventResolvedRegressions,
};

const SLACK_SCHEDULE_BY_CONDITION: Record<ScheduleCondition, SlackBlock[]> = {
  always: slackScheduleAlways,
  all_clean: slackScheduleAllClean,
  no_hard_failures: slackScheduleNoHardFailures,
};

function cloneBlocks(blocks: SlackBlock[]): SlackBlock[] {
  return JSON.parse(JSON.stringify(blocks)) as SlackBlock[];
}

export function defaultEventTemplate(
  provider: ChannelType,
  condition: EventCondition
): ChannelTemplate {
  if (provider === 'slack') {
    return { provider: 'slack', blocks: cloneBlocks(SLACK_EVENT_BY_CONDITION[condition]) };
  }
  return { provider: 'webhook', bodyJson: WEBHOOK_EVENT_JSON };
}

export function defaultScheduleTemplate(
  provider: ChannelType,
  condition: ScheduleCondition
): ChannelTemplate {
  if (provider === 'slack') {
    return { provider: 'slack', blocks: cloneBlocks(SLACK_SCHEDULE_BY_CONDITION[condition]) };
  }
  return { provider: 'webhook', bodyJson: WEBHOOK_SCHEDULE_JSON };
}
