export const getCustomSystemPrompt = (systemPrompt?: string): string =>
  systemPrompt ??
  'You are an expert test automation engineer and test failure analyst with deep knowledge of Playwright, testing best practices, and common failure patterns. Your role is to analyze test failures and suggest concrete improvements. Responses must be specific, actionable, and concise.';

export const testFailedWithContext = (
  basePrompt: string,
  context: {
    totalRuns?: number;
    averageDuration?: number;
    isFlaky?: boolean;
    recentFailures?: number;
    additionalContext?: string;
  }
) => {
  let enhancedPrompt = basePrompt;

  if (context.totalRuns) {
    enhancedPrompt += `- Total runs: ${context.totalRuns}\n`;
  }

  if (context.averageDuration) {
    enhancedPrompt += `- Average duration: ${context.averageDuration}ms\n`;
  }

  if (context.isFlaky) {
    enhancedPrompt += `- Status: Potentially flaky\n`;
  }

  if (context.recentFailures && context.recentFailures > 0) {
    enhancedPrompt += `- Recent failures: ${context.recentFailures}\n`;
  }

  if (context.additionalContext) {
    enhancedPrompt += `\n\n**Additional Context:**\n${context.additionalContext}\n`;
  }

  return enhancedPrompt;
};

export interface FailureDetailsForPrompt {
  message: string;
  stackTrace?: string;
  testTitle: string;
  filePath: string;
  location?: { file: string; line: number; column: number };
  attachments?: Array<{ name: string; path: string; contentType: string }>;
  attempt: number;
  status: string;
}

export const testFailureAnalysisPrompt = (
  failureDetails: FailureDetailsForPrompt,
  historicalContext?: {
    totalRuns?: number;
    recentFailureCount?: number;
    isFlaky?: boolean;
    previousCategories?: string[];
    isNewFailure?: boolean;
  }
): string => {
  let prompt = `Analyze this Playwright test failure and provide:\n`;
  prompt += `1. A failure **category** — pick exactly one from this fixed enum:\n`;
  prompt += `   - **timeout** — Playwright's TimeoutError or a test-level timeout, with no specific locator/visibility context\n`;
  prompt += `   - **element_not_visible** — \`expect(locator).toBeVisible()\` (or similar) timed out waiting for an element to appear/become interactable\n`;
  prompt += `   - **element_not_found** — locator resolved to 0 elements, or strict-mode violation\n`;
  prompt += `   - **assertion_error** — test-logic value mismatch (toEqual/toMatch/toContain/...) without timeout or locator context\n`;
  prompt += `   - **snapshot_mismatch** — visual / screenshot / toMatchSnapshot failure\n`;
  prompt += `   - **network_error** — \`net::ERR_*\`, ECONNREFUSED/ECONNRESET, transport-layer failure\n`;
  prompt += `   - **api_error** — explicit 4xx/5xx response from the app under test (non-auth)\n`;
  prompt += `   - **authentication_error** — 401/403, "Unauthorized", "Forbidden", or login/credential failures\n`;
  prompt += `   - **navigation_error** — page.goto/reload failure, frame detached, navigation timeout (when not a network transport error)\n`;
  prompt += `   - **browser_crash** — "Target closed", "Page crashed", browser/context disconnected\n`;
  prompt += `   - **setup_teardown** — error originating in beforeAll/afterAll/beforeEach/afterEach/fixture\n`;
  prompt += `   - **javascript_error** — ReferenceError/SyntaxError/TypeError, page.evaluate failures, uncaught promise rejections\n`;
  prompt += `   - **unknown** — only when none of the above clearly apply\n`;
  prompt += `2. A concise **analysis** of the root cause\n`;
  prompt += `3. A suggested **fix**\n`;
  prompt += `4. Whether this appears to be a **new issue** or a recurring pattern\n\n`;

  prompt += `## Test Details\n`;
  prompt += `- **Test:** ${failureDetails.testTitle}\n`;
  prompt += `- **File:** ${failureDetails.filePath}\n`;
  if (failureDetails.location) {
    prompt += `- **Location:** ${failureDetails.location.file}:${failureDetails.location.line}:${failureDetails.location.column}\n`;
  }
  prompt += `- **Attempt:** ${failureDetails.attempt}\n`;
  prompt += `- **Status:** ${failureDetails.status}\n\n`;

  prompt += `## Error Message\n\`\`\`\n${failureDetails.message}\n\`\`\`\n\n`;

  if (failureDetails.stackTrace) {
    prompt += `## Stack Trace\n\`\`\`\n${failureDetails.stackTrace}\n\`\`\`\n\n`;
  }

  if (failureDetails.attachments && failureDetails.attachments.length > 0) {
    prompt += `## Attachments\n`;
    for (const att of failureDetails.attachments) {
      prompt += `- ${att.name} (${att.contentType})\n`;
    }
    prompt += '\n';
  }

  if (historicalContext) {
    prompt += `## Historical Context\n`;
    if (historicalContext.totalRuns) {
      prompt += `- Total runs for this test: ${historicalContext.totalRuns}\n`;
    }
    if (historicalContext.recentFailureCount) {
      prompt += `- Recent failures: ${historicalContext.recentFailureCount}\n`;
    }
    if (historicalContext.isFlaky) {
      prompt += `- This test is flagged as flaky\n`;
    }
    if (historicalContext.isNewFailure) {
      prompt += `- This failure signature has NOT been seen before — likely a new issue\n`;
    } else if (historicalContext.isNewFailure === false) {
      prompt += `- This failure signature has been seen before — recurring issue\n`;
    }
    if (historicalContext.previousCategories && historicalContext.previousCategories.length > 0) {
      prompt += `- Previous failure categories: ${historicalContext.previousCategories.join(', ')}\n`;
    }
    prompt += '\n';
  }

  prompt += `Respond in JSON format: { "category": "...", "analysis": "markdown text", "isNew": true/false }\n`;

  return prompt;
};

export const reportFailureSummaryPrompt = (
  reportId: string,
  categories: Record<string, number>,
  errorGroups: Array<{
    signature: string;
    category: string;
    count: number;
    sampleMessage: string;
    affectedTests: string[];
  }>,
  perTestAnalyses: Array<{ testTitle: string; category: string; analysis: string }>
): string => {
  let prompt = `Summarize the test failures from this Playwright report.\n\n`;

  prompt += `## Report: ${reportId}\n\n`;

  const totalFailures = Object.values(categories).reduce((sum, c) => sum + c, 0);
  prompt += `## Failure Categories (${totalFailures} total failures)\n`;
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    prompt += `- **${cat}**: ${count} failures\n`;
  }
  prompt += '\n';

  if (errorGroups.length > 0) {
    prompt += `## Top Error Groups\n`;
    for (const group of errorGroups.slice(0, 10)) {
      prompt += `### ${group.category} (${group.count}x across ${group.affectedTests.length} tests)\n`;
      prompt += `\`\`\`\n${group.sampleMessage.substring(0, 500)}\n\`\`\`\n`;
      prompt += `Affected: ${group.affectedTests.slice(0, 5).join(', ')}${group.affectedTests.length > 5 ? ` +${group.affectedTests.length - 5} more` : ''}\n\n`;
    }
  }

  if (perTestAnalyses.length > 0) {
    prompt += `## Per-Test Analyses\n`;
    for (const analysis of perTestAnalyses.slice(0, 20)) {
      prompt += `- **${analysis.testTitle}** [${analysis.category}]: ${analysis.analysis.substring(0, 200)}\n`;
    }
    prompt += '\n';
  }

  prompt += `Provide:\n`;
  prompt += `1. An executive summary of the most impactful failure patterns\n`;
  prompt += `2. Root cause hypotheses for each major category\n`;
  prompt += `3. Prioritized actionable recommendations to reduce failures\n`;
  prompt += `4. Any correlations between failure types (e.g., same root cause across categories)\n`;

  return prompt;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export const buildFeedbackContext = (
  feedback: { comment: string; updatedAt: string } | null
): string => {
  if (!feedback) return '';
  return `\n## Prior User Feedback\n${feedback.comment}\nUpdated: ${relativeTime(feedback.updatedAt)}\n`;
};

export const buildPerTestFeedbackContext = (
  notes: Array<{ testTitle?: string; comment: string; updatedAt: string }>
): string => {
  if (notes.length === 0) return '';
  let block = `\n## Per-Test Feedback Notes\n`;
  for (const n of notes) {
    block += `- **${n.testTitle ?? 'test'}** (updated ${relativeTime(n.updatedAt)}): ${n.comment}\n`;
  }
  return block;
};

interface CrossProjectEntry {
  project: string;
  comment: string;
  updatedAt: string;
  errorSignatureMatchesCurrent: boolean;
  latestAnalysis?: { content: string; updatedAt: string; model?: string };
}

/**
 * Phase 2: same-test feedback in other projects. Each entry is labeled with project name,
 * relative age, and signature-match status so the model can self-prioritize. Capped at 5
 * by the caller (newest first); a tail line is appended when more exist.
 */
export const buildCrossProjectContext = (
  entries: CrossProjectEntry[],
  totalCount = entries.length
): string => {
  if (entries.length === 0) return '';
  let block = `\n## Same Test in Other Projects\n`;
  for (const e of entries) {
    const sig = e.errorSignatureMatchesCurrent ? 'matches' : 'differs';
    block += `\n### Project ${e.project} — feedback updated ${relativeTime(e.updatedAt)} — error signature: ${sig}\n`;
    block += `${e.comment}\n`;
    if (e.latestAnalysis) {
      const modelInfo = e.latestAnalysis.model ? `, model: ${e.latestAnalysis.model}` : '';
      block += `Latest analysis there (${relativeTime(e.latestAnalysis.updatedAt)}${modelInfo}):\n${e.latestAnalysis.content}\n`;
    }
  }
  if (totalCount > entries.length) {
    block += `\n… and ${totalCount - entries.length} more not shown.\n`;
  }
  return block;
};

export const projectFailureSummaryPrompt = (
  project: string,
  runs: Array<{
    reportId: string;
    createdAt: string;
    stats: { total: number; expected: number; unexpected: number; flaky: number; skipped: number };
    totalFailures: number;
    categories: Record<string, number>;
    llmSummary?: string;
  }>
): string => {
  const totalRuns = runs.length;
  const runsWithFailures = runs.filter((r) => r.totalFailures > 0);
  const passingRuns = totalRuns - runsWithFailures.length;

  let prompt = `Analyze the test health for project "${project}" across the latest ${totalRuns} runs.\n\n`;
  prompt += `**Overview:** ${passingRuns} of ${totalRuns} runs passed cleanly (no failures). ${runsWithFailures.length} runs had failures.\n\n`;
  prompt += `Runs are listed from most recent to oldest:\n\n`;

  for (const run of runs) {
    const status = run.totalFailures > 0 ? 'FAILURES' : 'PASS';
    prompt += `### Run ${run.reportId} (${run.createdAt}) — ${status}\n`;
    prompt += `- Tests: ${run.stats.total} total, ${run.stats.expected} passed, ${run.stats.unexpected} failed, ${run.stats.flaky} flaky, ${run.stats.skipped} skipped\n`;
    if (run.totalFailures > 0) {
      for (const [cat, count] of Object.entries(run.categories).sort((a, b) => b[1] - a[1])) {
        prompt += `  - ${cat}: ${count}\n`;
      }
      if (run.llmSummary) {
        prompt += `- Summary: ${run.llmSummary.substring(0, 300)}\n`;
      }
    }
    prompt += '\n';
  }

  prompt += `Provide:\n`;
  prompt += `1. Overall health assessment — consider that passing runs mean issues were resolved or absent\n`;
  prompt += `2. Identify which failures are transient (appeared and then resolved) vs persistent (recurring across multiple runs)\n`;
  prompt += `3. New issues that appeared recently and whether they have been resolved in subsequent runs\n`;
  prompt += `4. Top 3 prioritized recommendations for improving test stability\n`;
  prompt += `\nIMPORTANT: Account for the full timeline. If tests were passing before and after a failure, that failure is likely transient/already resolved — do not treat it as an ongoing critical issue.\n`;

  return prompt;
};
