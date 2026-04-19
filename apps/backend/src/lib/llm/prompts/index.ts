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
  prompt += `1. A failure **category** (one of: timeout, snapshot_mismatch, element_not_found, assertion_error, network_error, navigation_error, api_error, authentication_error, javascript_error, setup_teardown, browser_crash, unknown)\n`;
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
  errorGroups: Array<{ signature: string; category: string; count: number; sampleMessage: string; affectedTests: string[] }>,
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

export const projectFailureSummaryPrompt = (
  project: string,
  reportSummaries: Array<{ reportId: string; totalFailures: number; categories: Record<string, number>; llmSummary?: string; createdAt: string }>
): string => {
  let prompt = `Synthesize the test failure trends for project "${project}" across the last ${reportSummaries.length} reports.\n\n`;

  for (const summary of reportSummaries) {
    prompt += `### Report ${summary.reportId} (${summary.createdAt})\n`;
    prompt += `- Total failures: ${summary.totalFailures}\n`;
    for (const [cat, count] of Object.entries(summary.categories).sort((a, b) => b[1] - a[1])) {
      prompt += `  - ${cat}: ${count}\n`;
    }
    if (summary.llmSummary) {
      prompt += `- Summary: ${summary.llmSummary.substring(0, 300)}\n`;
    }
    prompt += '\n';
  }

  prompt += `Provide:\n`;
  prompt += `1. Overall trends — are failures increasing, decreasing, or stable?\n`;
  prompt += `2. Persistent issues that appear across multiple reports\n`;
  prompt += `3. New issues that appeared recently\n`;
  prompt += `4. Top 3 prioritized recommendations for improving test stability\n`;

  return prompt;
};
