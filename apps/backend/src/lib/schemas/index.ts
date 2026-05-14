import { z } from 'zod';

export const UUIDSchema = z.uuid();

export const PaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10),
  offset: z.coerce.number().min(0).default(0),
});

export const ReportMetadataSchema = z.looseObject({
  project: z.string().optional(),
  title: z.string().optional(),
  playwrightVersion: z.string().optional(),
  testRun: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const ReportHistorySchema = z.looseObject({
  reportID: UUIDSchema,
  project: z.string(),
  title: z.string().optional(),
  createdAt: z.string(),
  reportUrl: z.string(),
  size: z.string().optional(),
  sizeBytes: z.number(),
  stats: z
    .object({
      total: z.number(),
      expected: z.number(),
      unexpected: z.number(),
      flaky: z.number(),
      skipped: z.number(),
      ok: z.boolean(),
    })
    .optional(),
});

export const ResultDetailsSchema = z.looseObject({
  resultID: UUIDSchema,
  project: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.string(),
  size: z.string().optional(),
  sizeBytes: z.number(),
  playwrightVersion: z.string().optional(),
  testRun: z.string().optional(),
  shardCurrent: z.number().optional(),
  shardTotal: z.number().optional(),
  triggerReportGeneration: z.coerce.boolean().optional(),
});

export const GenerateReportRequestSchema = z.looseObject({
  resultsIds: z.array(z.string()).min(1),
  project: z.string().optional(),
  playwrightVersion: z.string().optional(),
  title: z.string().optional(),
});

export const GenerateReportResponseSchema = z.object({
  reportId: z.string(),
  reportUrl: z.string(),
  metadata: ReportMetadataSchema,
});

export const ListReportsQuerySchema = z.object({
  project: z.string().default(''),
  search: z.string().default(''),
  tags: z.string().optional(), // comma-separated
  from: z.string().optional(),
  to: z.string().optional(),
  passRate: z.enum(['all', 'passing', 'failing', 'below-threshold']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

export const ListReportsResponseSchema = z.object({
  reports: z.array(ReportHistorySchema),
  total: z.number(),
});

export const CompareReportsQuerySchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
});

const DiffOutcomeSchema = z.enum(['pass', 'fail', 'flaky', 'skipped', 'unknown']);

const ReportRefSchema = z.object({
  reportID: z.string(),
  title: z.string().optional(),
  displayNumber: z.number().optional(),
  project: z.string(),
  createdAt: z.string(),
  reportUrl: z.string(),
  stats: z
    .object({
      total: z.number(),
      expected: z.number().optional(),
      unexpected: z.number().optional(),
      flaky: z.number().optional(),
      skipped: z.number().optional(),
      ok: z.boolean().optional(),
    })
    .optional(),
});

const DiffTestEntrySchema = z.object({
  testId: z.string(),
  fileId: z.string(),
  project: z.string(),
  title: z.string(),
  filePath: z.string(),
  outcomeA: DiffOutcomeSchema.optional(),
  outcomeB: DiffOutcomeSchema.optional(),
  rawOutcomeA: z.string().optional(),
  rawOutcomeB: z.string().optional(),
  durationA: z.number().optional(),
  durationB: z.number().optional(),
});

const DurationDeltaEntrySchema = DiffTestEntrySchema.extend({
  durationA: z.number(),
  durationB: z.number(),
  deltaMs: z.number(),
  deltaPct: z.number(),
});

export const CompareReportsResponseSchema = z.object({
  reportA: ReportRefSchema,
  reportB: ReportRefSchema,
  summary: z.object({
    totalA: z.number(),
    totalB: z.number(),
    newlyFailedCount: z.number(),
    fixedCount: z.number(),
    stillFailingCount: z.number(),
    flakyToPassCount: z.number(),
    passToFlakyCount: z.number(),
    newTestsCount: z.number(),
    removedTestsCount: z.number(),
    durationRegressionsCount: z.number(),
    durationImprovementsCount: z.number(),
  }),
  newlyFailed: z.array(DiffTestEntrySchema),
  fixed: z.array(DiffTestEntrySchema),
  stillFailing: z.array(DiffTestEntrySchema),
  flakyToPass: z.array(DiffTestEntrySchema),
  passToFlaky: z.array(DiffTestEntrySchema),
  newTests: z.array(DiffTestEntrySchema),
  removedTests: z.array(DiffTestEntrySchema),
  durationDeltas: z.array(DurationDeltaEntrySchema),
});

export const DeleteReportsRequestSchema = z.object({
  reportsIds: z.array(z.string()).min(1),
});

export const DeleteReportsResponseSchema = z.object({
  message: z.string(),
  reportsIds: z.array(z.string()),
});

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

export const ListResultsResponseSchema = z.object({
  results: z.array(ResultDetailsSchema),
  total: z.number(),
});

export const DeleteResultsRequestSchema = z.object({
  resultsIds: z.array(z.string()).min(1),
});

export const DeleteResultsResponseSchema = z.object({
  message: z.string(),
  resultsIds: z.array(z.string()),
});

export const GetReportParamsSchema = z.object({
  id: z.string(),
});

export const GetReportResponseSchema = ReportHistorySchema;

export const UploadResultResponseSchema = z.object({
  message: z.string(),
  data: z.object({
    resultID: UUIDSchema,
    generatedReport: GenerateReportResponseSchema.optional().nullable(),
    testRun: z.string().optional(),
  }),
});

export const UploadReportRequestSchema = z.looseObject({
  project: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const UploadReportResponseSchema = z.object({
  reportId: z.string(),
  reportUrl: z.string(),
  metadata: ReportMetadataSchema,
});

export const ServerInfoSchema = z.object({
  dataFolderSizeinMB: z.string(),
  numOfResults: z.number(),
  resultsFolderSizeinMB: z.string(),
  numOfReports: z.number(),
  reportsFolderSizeinMB: z.string(),
  availableSizeinMB: z.string(),
});

export const ConfigSchema = z.looseObject({
  siteName: z.string().optional(),
  logoUrl: z.string().optional(),
  theme: z.string().optional(),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

// Feedback is always test-level. Identity: testId + (fileId+project) OR (reportId).
// Server resolves missing fileId/project from test_runs when only reportId is provided
// — used by the injected Playwright panel which only knows what's in the URL.
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

// Phase 2: cross-project related feedback. Either (fileId+excludeProject) — full identity —
// or (reportId) — let the server resolve fileId+project from test_runs.
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
    /** When true and reportId is set, also enqueue a report_summary task for that report. */
    cascadeReportSummary: z.boolean().optional(),
  })
  .refine(testKeysRefinement, { message: testKeysMessage })
  .refine((data) => !data.cascadeReportSummary || !!data.reportId, {
    message: 'cascadeReportSummary=true requires reportId',
  });

export type GenerateReportRequest = z.infer<typeof GenerateReportRequestSchema>;
export type GenerateReportResponse = z.infer<typeof GenerateReportResponseSchema>;
export type ListReportsQuery = z.infer<typeof ListReportsQuerySchema>;
export type ListReportsResponse = z.infer<typeof ListReportsResponseSchema>;
export type DeleteReportsRequest = z.infer<typeof DeleteReportsRequestSchema>;
export type DeleteReportsResponse = z.infer<typeof DeleteReportsResponseSchema>;
export type ListResultsQuery = z.infer<typeof ListResultsQuerySchema>;
export type ListResultsResponse = z.infer<typeof ListResultsResponseSchema>;
export type DeleteResultsRequest = z.infer<typeof DeleteResultsRequestSchema>;
export type DeleteResultsResponse = z.infer<typeof DeleteResultsResponseSchema>;
export type GetReportParams = z.infer<typeof GetReportParamsSchema>;
export type GetReportResponse = z.infer<typeof GetReportResponseSchema>;
export type UploadResultResponse = z.infer<typeof UploadResultResponseSchema>;
export type UploadReportRequest = z.infer<typeof UploadReportRequestSchema>;
export type UploadReportResponse = z.infer<typeof UploadReportResponseSchema>;
export type ServerInfo = z.infer<typeof ServerInfoSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type ReportMetadata = z.infer<typeof ReportMetadataSchema>;
export type ReportHistory = z.infer<typeof ReportHistorySchema>;
export type ResultDetails = z.infer<typeof ResultDetailsSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
