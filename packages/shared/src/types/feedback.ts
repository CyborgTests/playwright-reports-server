/** Test-level feedback note. There is no report-level feedback — the report summary is
 *  itself an aggregation of test analyses, so any user feedback belongs at the test level. */
export interface AnalysisFeedback {
  id: string;
  testId?: string;
  fileId?: string;
  project: string;
  reportId?: string;
  errorSignature?: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

/** Phase 2: returned by GET /api/llm/test-history — failure occurrence history for a test
 *  with this errorSignature. Drives the "🆕 New error" / "🔁 N prior" header chip and the
 *  "First found in report X" inline marker. Both fields are 0/null when no errorSignature is
 *  set on the current test_run, or when no prior runs match.
 */
export interface TestFailureHistory {
  priorOccurrenceCount: number;
  firstOccurrence: { reportId: string; createdAt: string } | null;
}

/** Phase 2: returned by GET /api/llm/feedback/related — one entry per other project that
 *  has feedback for the same test. Drives both the prompt-injected cross-project block and
 *  the UI link-out chooser. */
export interface RelatedFeedbackEntry {
  project: string;
  feedback: AnalysisFeedback;
  /** Latest persisted analysis for this test in that project, if any. */
  latestAnalysis?: {
    analysis: string;
    updatedAt: string;
    model?: string;
  };
  /** True when the related feedback's errorSignature matches the current test_run's. */
  errorSignatureMatchesCurrent: boolean;
}

export interface FeedbackUpsertRequest {
  testId: string;
  fileId?: string;
  project?: string;
  reportId?: string;
  comment: string;
}

export interface RegenerateRequest {
  testId: string;
  fileId?: string;
  project?: string;
  reportId?: string;
  /** When true and reportId is set, also enqueue a report_summary task for that report.
   *  Used by the injected Playwright panel's "Also refresh report summary" checkbox. */
  cascadeReportSummary?: boolean;
}
