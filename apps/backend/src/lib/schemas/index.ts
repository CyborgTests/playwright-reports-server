import {
  isOpaqueMaskSentinel,
  isUrlMaskSentinel,
  RESERVED_REPORT_FIELDS,
  SECRET_MASK,
} from '@playwright-reports/shared';
import { z } from 'zod';

function notMaskGarbage(s: string): boolean {
  return !s.includes(SECRET_MASK) || isOpaqueMaskSentinel(s);
}

export const UUIDSchema = z.uuid();

export const GenerateReportRequestSchema = z.looseObject({
  resultsIds: z.array(z.string()).min(1),
  project: z.string().optional(),
  playwrightVersion: z.string().optional(),
  title: z.string().optional(),
});

export const ListReportsQuerySchema = z.object({
  project: z.string().default(''),
  search: z.string().default(''),
  tags: z.string().optional(), // comma-separated
  from: z.string().optional(),
  to: z.string().optional(),
  passRate: z.enum(['all', 'passing', 'failing', 'below-threshold']).optional(),
  regressionsOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

export const CompareReportsQuerySchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  project: z.string().optional(),
});

export const DeleteReportsRequestSchema = z.object({
  reportsIds: z.array(z.string()).min(1),
});

export const ResolveClusterParamsSchema = z.object({
  id: z.string().min(1).max(128),
});

export const ResolveClusterBodySchema = z.object({
  project: z.string().trim().min(1).max(256).optional(),
  note: z.string().max(2000).optional(),
});

export const EditReportsRequestSchema = z
  .object({
    reportsIds: z.array(z.string()).min(1).max(500),
    project: z.string().trim().min(1).max(256).optional(),
    tags: z
      .record(
        z
          .string()
          .min(1)
          .max(128)
          .refine((k) => !RESERVED_REPORT_FIELDS.has(k), {
            message: 'Tag key cannot shadow a core report field',
          }),
        z.string().max(2000)
      )
      .optional(),
    removeTags: z.array(z.string().min(1).max(128)).max(50).optional(),
  })
  .refine(
    (v) =>
      v.project !== undefined ||
      (v.tags && Object.keys(v.tags).length > 0) ||
      (v.removeTags && v.removeTags.length > 0),
    { message: 'At least one of project, tags, or removeTags must be provided' }
  );

export const ListResultsQuerySchema = z.object({
  project: z.string().default(''),
  search: z.string().default(''),
  tags: z.string().optional(), // comma-separated
  from: z.string().optional(),
  to: z.string().optional(),
  usage: z.enum(['all', 'used', 'unused']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

export const DeleteResultsRequestSchema = z.object({
  resultsIds: z.array(UUIDSchema).min(1),
});

export const GetReportParamsSchema = z.object({
  id: z.string(),
});

export const ExportReportPdfQuerySchema = z.object({
  scope: z.enum(['failures', 'all']).default('all'),
  compare: z.string().min(1).optional(),
  screenshots: z.enum(['0', '1']).default('1'),
  analysis: z.enum(['0', '1']).default('1'),
  onePerPage: z.enum(['0', '1']).default('1'),
});

export const UploadReportRequestSchema = z.looseObject({
  project: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const testKeyShape = {
  testId: z.string().min(1),
  fileId: z.string().optional(),
  project: z.string().optional(),
  reportId: z.string().optional(),
} as const;

const testKeysRefinement = (data: {
  testId: string;
  fileId?: string;
  project?: string;
  reportId?: string;
}) => !!(data.fileId && data.project) || !!data.reportId;

const testKeysMessage = 'feedback requires testId AND ((fileId+project) OR reportId)';

export const GetFeedbackQuerySchema = z
  .object(testKeyShape)
  .refine(testKeysRefinement, { message: testKeysMessage });

export const UpsertFeedbackRequestSchema = z
  .object({
    ...testKeyShape,
    comment: z.string().trim().min(1, 'comment must be non-empty'),
  })
  .refine(testKeysRefinement, { message: testKeysMessage });

export const DeleteFeedbackRequestSchema = z
  .object(testKeyShape)
  .refine(testKeysRefinement, { message: testKeysMessage });

export const GetRelatedFeedbackQuerySchema = z
  .object({
    testId: z.string().min(1),
    fileId: z.string().optional(),
    excludeProject: z.string().optional(),
    reportId: z.string().optional(),
  })
  .refine((data) => !!((data.fileId && data.excludeProject) || data.reportId), {
    message:
      '/related requires (fileId + excludeProject) OR reportId so the server can resolve the test',
  });

export const FeedbackRegenerateRequestSchema = z
  .object({
    ...testKeyShape,
    cascadeReportSummary: z.boolean().optional(),
  })
  .refine(testKeysRefinement, { message: testKeysMessage })
  .refine((data) => !data.cascadeReportSummary || !!data.reportId, {
    message: 'cascadeReportSummary=true requires reportId',
  });

const ReportAnalysisCodeRefSchema = z.object({
  kind: z.enum(['test', 'file']),
  label: z.string(),
  testId: z.string().optional(),
  fileId: z.string().optional(),
  filePath: z.string().optional(),
  project: z.string().optional(),
  line: z.number().int().positive().optional(),
});

const ReportAnalysisSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  impact: z.enum(['high', 'medium', 'low']).optional(),
  codeRefs: z.array(ReportAnalysisCodeRefSchema).optional(),
});

const ReportAnalysisStructuredSchema = z.object({
  verdict: z.enum(['isolated', 'clustered', 'widespread', 'systemic']),
  summary: z.string(),
  sections: z.array(ReportAnalysisSectionSchema),
  reportId: z.string().optional(),
});

const ProjectAnalysisCodeRefSchema = z.object({
  kind: z.enum(['test', 'file']),
  label: z.string(),
  testId: z.string().optional(),
  fileId: z.string().optional(),
  filePath: z.string().optional(),
  project: z.string().optional(),
  reportId: z.string().optional(),
  line: z.number().int().positive().optional(),
});

const ProjectAnalysisSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  codeRefs: z.array(ProjectAnalysisCodeRefSchema).optional(),
});

const ProjectAnalysisStructuredSchema = z.object({
  verdict: z.enum(['healthy', 'stabilizing', 'degrading', 'failing']),
  summary: z.string(),
  sections: z.array(ProjectAnalysisSectionSchema),
  latestReportId: z.string().optional(),
});

export const SubmitTestAnalysisRequestSchema = z.object({
  reportId: z.string().min(1),
  analysis: z.string().trim().min(1, 'analysis must be non-empty'),
  category: z.string().optional(),
  model: z.string().trim().min(1, 'model must be non-empty'),
  force: z.boolean().optional(),
});

export const SubmitReportSummaryRequestSchema = z.object({
  llmSummary: z.string().trim().min(1, 'llmSummary must be non-empty'),
  llmSummaryStructured: ReportAnalysisStructuredSchema.optional(),
  model: z.string().trim().min(1, 'model must be non-empty'),
  force: z.boolean().optional(),
});

export const SubmitProjectSummaryRequestSchema = z.object({
  summary: z.string().trim().min(1, 'summary must be non-empty'),
  structured: ProjectAnalysisStructuredSchema.optional(),
  model: z.string().trim().min(1, 'model must be non-empty'),
  lastReportId: z.string().optional(),
  reportCount: z.number().int().nonnegative().optional(),
  firstReportAt: z.string().optional(),
  lastReportAt: z.string().optional(),
  force: z.boolean().optional(),
});

const ProjectFilterSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('project'), name: z.string().min(1).max(200) }),
  z.object({
    mode: z.literal('regex'),
    pattern: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (p) => {
          try {
            new RegExp(p);
            return true;
          } catch {
            return false;
          }
        },
        { message: 'Invalid regular expression' }
      ),
  }),
]);

const SlackButtonSchema = z.object({
  label: z.string().min(1).max(75),
  url: z.string().min(1).max(3000),
});

const SlackBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('header'), text: z.string().min(1).max(150) }),
  z.object({ type: z.literal('section'), text: z.string().min(1).max(3000) }),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('context'), text: z.string().min(1).max(3000) }),
  z.object({
    type: z.literal('actions'),
    buttons: z.array(SlackButtonSchema).min(0).max(5),
  }),
  z.object({
    type: z.literal('image'),
    url: z.string().min(1).max(3000),
    altText: z.string().max(2000).optional(),
  }),
]);

const ChannelTemplateSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('slack'),
    blocks: z.array(SlackBlockSchema).min(1).max(50),
  }),
  z.object({
    provider: z.literal('webhook'),
    bodyJson: z
      .string()
      .max(20_000)
      .refine(
        (s) => {
          const stripped = s.replace(/\{\{\s*[#^/!][^}]*\}\}/g, '').replace(/\{\{[^}]+\}\}/g, '0');
          try {
            JSON.parse(stripped);
            return true;
          } catch {
            return false;
          }
        },
        { message: 'Body must be valid JSON (Mustache placeholders allowed)' }
      ),
  }),
]);

const EventRuleSchema = z.object({
  id: UUIDSchema,
  kind: z.literal('event'),
  enabled: z.boolean().optional(),
  event: z.literal('report_uploaded'),
  condition: z.enum([
    'always',
    'has_failures',
    'pass_rate_below_100',
    'recovered_to_clean',
    'recovered_no_hard_failures',
  ]),
  projectFilter: ProjectFilterSchema,
  template: ChannelTemplateSchema.optional(),
});

const ScheduleCadenceSchema = z.union([
  z.literal('daily'),
  z.literal('weekly'),
  z.object({
    cron: z
      .string()
      .min(1)
      .max(100)
      .refine((s) => /^[\d*/,\- ]+$/.test(s) && s.trim().split(/\s+/).length === 5, {
        message: 'Cron must be 5 space-separated fields',
      }),
  }),
]);

const ScheduleRuleSchema = z.object({
  id: UUIDSchema,
  kind: z.literal('schedule'),
  enabled: z.boolean().optional(),
  cadence: ScheduleCadenceSchema,
  sendAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'sendAt must be HH:mm')
    .default('09:00'),
  window: z.enum(['last_24h', 'last_7d', 'last_14d', 'since_last_send']),
  condition: z.enum(['always', 'all_clean', 'no_hard_failures']),
  projectFilter: ProjectFilterSchema,
  template: ChannelTemplateSchema.optional(),
});

const NotificationRuleSchema = z.discriminatedUnion('kind', [EventRuleSchema, ScheduleRuleSchema]);

const SlackChannelConfigSchema = z.object({
  webhookUrl: z
    .string()
    .min(1)
    .max(2000)
    .refine((s) => isUrlMaskSentinel(s) || isValidHttpsUrl(s), 'Invalid Slack webhook URL'),
});

const WebhookChannelConfigSchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2000)
    .refine((s) => isUrlMaskSentinel(s) || isValidHttpsUrl(s), 'Invalid URL'),
  headers: z
    .record(
      z.string(),
      z.string().max(1000).refine(notMaskGarbage, 'Header value cannot contain the mask sentinel')
    )
    .optional(),
  secretHmacKey: z
    .string()
    .min(8)
    .max(512)
    .refine(notMaskGarbage, 'HMAC key cannot contain the mask sentinel')
    .optional(),
});

function isValidHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const NotificationChannelSchema = z.discriminatedUnion('type', [
  z.object({
    id: UUIDSchema,
    name: z.string().min(1).max(100),
    type: z.literal('slack'),
    enabled: z.boolean(),
    config: SlackChannelConfigSchema,
    rules: z.array(NotificationRuleSchema),
  }),
  z.object({
    id: UUIDSchema,
    name: z.string().min(1).max(100),
    type: z.literal('webhook'),
    enabled: z.boolean(),
    config: WebhookChannelConfigSchema,
    rules: z.array(NotificationRuleSchema),
  }),
]);

export const NotificationsConfigSchema = z.object({
  enabled: z.boolean(),
  channels: z.array(NotificationChannelSchema).max(100),
});

export const NotificationTestRequestSchema = z.object({
  channelId: UUIDSchema,
  reportId: UUIDSchema.optional(),
  ruleIds: z.array(UUIDSchema).optional(),
  rule: NotificationRuleSchema.optional(),
});

export const NotificationLogDeleteSchema = z.object({
  ids: z.array(UUIDSchema).min(1).max(500),
});

export const NotificationLogQuerySchema = z.object({
  channelId: UUIDSchema.optional(),
  status: z.enum(['success', 'failed', 'skipped']).optional(),
  source: z.enum(['live', 'test']).optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});
