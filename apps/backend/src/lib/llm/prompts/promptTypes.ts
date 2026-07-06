export type { PromptSegment, SegmentedPrompt } from '../types/index.js';

export interface MustacheSubstitution {
  substituted: boolean;
  rendered: string;
}

export interface CustomPromptOverrides {
  systemPrompt?: string;
  testAnalysisSystemPrompt?: string;
  projectSummarySystemPrompt?: string;
  testAnalysisInstructions?: string;
  projectSummaryInstructions?: string;
  reportSummaryPrompt?: string;
  project?: string;
  generalContext?: string;
}

export interface RunContext {
  gitCommit?: {
    hash?: string;
    shortHash?: string;
    branch?: string;
    subject?: string;
  };
  ci?: {
    buildHref?: string;
    commitHref?: string;
    commitHash?: string;
  };
  playwrightVersion?: string;
  actualWorkers?: number;
  createdAt?: string;
}

export type ReportSummaryRunContext = RunContext;
