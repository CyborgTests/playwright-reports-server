import type {
  LlmScreenshotSource,
  LlmTaskRouting,
  LlmTaskType,
  SiteWhiteLabelConfig,
} from '@playwright-reports/shared';
import { SCREENSHOTS_MAX_CAP } from '@playwright-reports/shared';
import { validateRouting } from '../llm/routing/index.js';
import { CronService } from '../service/cron.js';
import { llmModelsDb } from '../service/db/index.js';

export interface ConfigFormData {
  title?: string;
  serverBaseUrl?: string;
  logoPath?: string;
  logoInvertOnDark?: string;
  allowOpenRegistration?: string;
  defaultUserRole?: string;
  faviconPath?: string;
  reporterPaths?: string;
  headerLinks?: string;
  resultExpireDays?: string;
  resultExpireCronSchedule?: string;
  reportExpireDays?: string;
  reportExpireCronSchedule?: string;
  llmFeatureEnabled?: string;
  llmUseFallbackChain?: string;
  llmRouting?: string;
  llmAutoAnalyzeNewReports?: string;
  llmAutoProjectSummaryOnReportComplete?: string;
  llmAnalyzeGreenWindows?: string;
  llmGeneralContext?: string;
  llmCustomSystemPrompt?: string;
  llmCustomTestAnalysisSystemPrompt?: string;
  llmCustomProjectSummarySystemPrompt?: string;
  llmCustomTestAnalysisInstructions?: string;
  llmCustomReportSummaryPrompt?: string;
  llmCustomProjectSummaryInstructions?: string;
  llmCustomSynthesizerPrompt?: string;
  llmCustomJudgePrompt?: string;
  llmCustomCritiquePrompt?: string;
  llmCustomRevisePrompt?: string;
  llmCustomScorerPrompt?: string;
  llmScreenshotModel?: string;
  llmCustomScreenshotParsePrompt?: string;
  llmScreenshotSources?: string;
  llmMaxScreenshots?: string;
  testManagementQuarantineThresholdPercentage?: string;
  testManagementWarningThresholdPercentage?: string;
  testManagementAutoQuarantineEnabled?: string;
  testManagementFlakinessMinRuns?: string;
  testManagementFlakinessEvaluationWindowDays?: string;
}

// Explicit allow-list of accepted multipart field names. Anything not in this
// set is dropped, so we cannot smuggle __proto__/constructor/etc.
// into the formData object.
export const ALLOWED_CONFIG_FIELDS: ReadonlySet<keyof ConfigFormData> = new Set<
  keyof ConfigFormData
>([
  'title',
  'serverBaseUrl',
  'logoPath',
  'logoInvertOnDark',
  'allowOpenRegistration',
  'defaultUserRole',
  'faviconPath',
  'reporterPaths',
  'headerLinks',
  'resultExpireDays',
  'resultExpireCronSchedule',
  'reportExpireDays',
  'reportExpireCronSchedule',
  'llmFeatureEnabled',
  'llmUseFallbackChain',
  'llmRouting',
  'llmAutoAnalyzeNewReports',
  'llmAutoProjectSummaryOnReportComplete',
  'llmAnalyzeGreenWindows',
  'llmGeneralContext',
  'llmCustomSystemPrompt',
  'llmCustomTestAnalysisSystemPrompt',
  'llmCustomProjectSummarySystemPrompt',
  'llmCustomTestAnalysisInstructions',
  'llmCustomReportSummaryPrompt',
  'llmCustomProjectSummaryInstructions',
  'llmCustomSynthesizerPrompt',
  'llmCustomJudgePrompt',
  'llmCustomCritiquePrompt',
  'llmCustomRevisePrompt',
  'llmCustomScorerPrompt',
  'llmScreenshotModel',
  'llmCustomScreenshotParsePrompt',
  'llmScreenshotSources',
  'llmMaxScreenshots',
  'testManagementQuarantineThresholdPercentage',
  'testManagementWarningThresholdPercentage',
  'testManagementAutoQuarantineEnabled',
  'testManagementFlakinessMinRuns',
  'testManagementFlakinessEvaluationWindowDays',
]);

type PromptKey =
  | 'customSystemPrompt'
  | 'customTestAnalysisSystemPrompt'
  | 'customProjectSummarySystemPrompt'
  | 'customTestAnalysisInstructions'
  | 'customReportSummaryPrompt'
  | 'customProjectSummaryInstructions'
  | 'customSynthesizerPrompt'
  | 'customJudgePrompt'
  | 'customCritiquePrompt'
  | 'customRevisePrompt'
  | 'customScorerPrompt'
  | 'customScreenshotParsePrompt';

// Form field -> config.llm property for the free-text prompt overrides, which
// all share the same `value || undefined` handling.
const CUSTOM_PROMPT_FIELDS: Array<[keyof ConfigFormData, PromptKey]> = [
  ['llmCustomSystemPrompt', 'customSystemPrompt'],
  ['llmCustomTestAnalysisSystemPrompt', 'customTestAnalysisSystemPrompt'],
  ['llmCustomProjectSummarySystemPrompt', 'customProjectSummarySystemPrompt'],
  ['llmCustomTestAnalysisInstructions', 'customTestAnalysisInstructions'],
  ['llmCustomReportSummaryPrompt', 'customReportSummaryPrompt'],
  ['llmCustomProjectSummaryInstructions', 'customProjectSummaryInstructions'],
  ['llmCustomSynthesizerPrompt', 'customSynthesizerPrompt'],
  ['llmCustomJudgePrompt', 'customJudgePrompt'],
  ['llmCustomCritiquePrompt', 'customCritiquePrompt'],
  ['llmCustomRevisePrompt', 'customRevisePrompt'],
  ['llmCustomScorerPrompt', 'customScorerPrompt'],
  ['llmCustomScreenshotParsePrompt', 'customScreenshotParsePrompt'],
];

export interface ApplyConfigError {
  status: number;
  error: string;
}

// Applies the LLM / cron / test-management form fields onto `config` in place.
// Returns the first validation error encountered, or null on success. Branding,
// server, reporter and header-link fields are handled by the route (they need
// file I/O and storage uploads).
export function applyConfigFormData(
  config: SiteWhiteLabelConfig,
  formData: ConfigFormData
): ApplyConfigError | null {
  config.llm ??= {};
  const llm = config.llm;

  if (formData.llmFeatureEnabled !== undefined) {
    const enable = formData.llmFeatureEnabled === 'true';
    if (enable && !llmModelsDb.getPrimary()) {
      return { status: 409, error: 'Set a primary model before enabling LLM features' };
    }
    llm.featureEnabled = enable;
  }

  if (formData.llmUseFallbackChain !== undefined) {
    llm.useFallbackChain = formData.llmUseFallbackChain === 'true';
  }

  if (formData.llmRouting !== undefined) {
    let parsedRouting: unknown;
    try {
      parsedRouting = JSON.parse(formData.llmRouting);
    } catch {
      return { status: 400, error: 'llmRouting must be valid JSON' };
    }
    const enabledIds = new Set(
      llmModelsDb
        .list()
        .filter((m) => m.enabled === 1)
        .map((m) => m.id)
    );
    const routingError = validateRouting(parsedRouting, enabledIds);
    if (routingError) return { status: 400, error: routingError };
    llm.routing = parsedRouting as Partial<Record<LlmTaskType, LlmTaskRouting>>;
  }

  if (formData.llmAutoAnalyzeNewReports !== undefined) {
    llm.autoAnalyzeNewReports = formData.llmAutoAnalyzeNewReports === 'true';
  }

  if (formData.llmAutoProjectSummaryOnReportComplete !== undefined) {
    llm.autoProjectSummaryOnReportComplete =
      formData.llmAutoProjectSummaryOnReportComplete === 'true';
  }

  if (formData.llmAnalyzeGreenWindows !== undefined) {
    llm.analyzeGreenWindows = formData.llmAnalyzeGreenWindows === 'true';
  }

  if (formData.llmGeneralContext !== undefined) {
    const trimmed = formData.llmGeneralContext.trim();
    if (trimmed.length > 500) {
      return { status: 400, error: 'LLM general context must be 500 characters or fewer' };
    }
    llm.generalContext = trimmed || undefined;
  }

  for (const [field, key] of CUSTOM_PROMPT_FIELDS) {
    const value = formData[field];
    if (value !== undefined) llm[key] = value || undefined;
  }

  if (formData.llmScreenshotModel !== undefined) {
    const modelId = formData.llmScreenshotModel.trim();
    if (modelId) {
      const isEnabled = llmModelsDb.list().some((m) => m.id === modelId && m.enabled === 1);
      if (!isEnabled) {
        return { status: 400, error: 'llmScreenshotModel references an unknown or disabled model' };
      }
      llm.screenshotModel = { modelId };
    } else {
      llm.screenshotModel = undefined;
    }
  }

  if (formData.llmScreenshotSources !== undefined) {
    const valid: LlmScreenshotSource[] = ['attachment', 'failing_action', 'series'];
    const parsed = formData.llmScreenshotSources
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const s of parsed) {
      if (!valid.includes(s as LlmScreenshotSource)) {
        return { status: 400, error: `llmScreenshotSources has invalid value "${s}"` };
      }
    }
    // de-dupe while preserving order; empty list = no screenshots (kept as []).
    llm.screenshotSources = [...new Set(parsed)] as LlmScreenshotSource[];
  }

  if (formData.llmMaxScreenshots !== undefined) {
    const raw = formData.llmMaxScreenshots.trim();
    const n = raw === '' ? Number.NaN : Number(raw);
    llm.maxScreenshots = Number.isFinite(n)
      ? Math.min(SCREENSHOTS_MAX_CAP, Math.max(1, Math.round(n)))
      : undefined;
  }

  config.cron ??= {};
  const cron = config.cron;

  const parseExpireDays = (raw: string | undefined): number | undefined | { error: string } => {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const days = Number.parseInt(trimmed, 10);
    if (Number.isNaN(days) || days < 0) return { error: 'must be a non-negative integer' };
    return days;
  };
  const parseCronSchedule = (raw: string | undefined): string | undefined | { error: string } => {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const validation = CronService.validateExpression(trimmed);
    if (!validation.valid) return { error: `is invalid: ${validation.error}` };
    return trimmed;
  };

  if (formData.resultExpireDays !== undefined) {
    const parsed = parseExpireDays(formData.resultExpireDays);
    if (parsed && typeof parsed === 'object') {
      return { status: 400, error: `resultExpireDays ${parsed.error}` };
    }
    cron.resultExpireDays = parsed;
  }
  if (formData.reportExpireDays !== undefined) {
    const parsed = parseExpireDays(formData.reportExpireDays);
    if (parsed && typeof parsed === 'object') {
      return { status: 400, error: `reportExpireDays ${parsed.error}` };
    }
    cron.reportExpireDays = parsed;
  }
  if (formData.resultExpireCronSchedule !== undefined) {
    const parsed = parseCronSchedule(formData.resultExpireCronSchedule);
    if (parsed && typeof parsed === 'object') {
      return { status: 400, error: `resultExpireCronSchedule ${parsed.error}` };
    }
    cron.resultExpireCronSchedule = parsed;
  }
  if (formData.reportExpireCronSchedule !== undefined) {
    const parsed = parseCronSchedule(formData.reportExpireCronSchedule);
    if (parsed && typeof parsed === 'object') {
      return { status: 400, error: `reportExpireCronSchedule ${parsed.error}` };
    }
    cron.reportExpireCronSchedule = parsed;
  }

  config.testManagement ??= {};
  const tm = config.testManagement;

  if (formData.testManagementQuarantineThresholdPercentage !== undefined) {
    const threshold = Number.parseInt(formData.testManagementQuarantineThresholdPercentage, 10);
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
      return {
        status: 400,
        error: 'Test management quarantine threshold must be a number between 0 and 100',
      };
    }
    tm.quarantineThresholdPercentage = threshold;
  }

  if (formData.testManagementWarningThresholdPercentage !== undefined) {
    const threshold = Number.parseInt(formData.testManagementWarningThresholdPercentage, 10);
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
      return {
        status: 400,
        error: 'Test management warning threshold must be a number between 0 and 100',
      };
    }
    tm.warningThresholdPercentage = threshold;
  }

  if (formData.testManagementAutoQuarantineEnabled !== undefined) {
    tm.autoQuarantineEnabled = formData.testManagementAutoQuarantineEnabled === 'true';
  }

  if (formData.testManagementFlakinessMinRuns !== undefined) {
    const minRuns = Number.parseInt(formData.testManagementFlakinessMinRuns, 10);
    if (Number.isNaN(minRuns) || minRuns < 1) {
      return { status: 400, error: 'Test management minimum runs must be a number greater than 0' };
    }
    tm.flakinessMinRuns = minRuns;
  }

  if (formData.testManagementFlakinessEvaluationWindowDays !== undefined) {
    const windowDays = Number.parseInt(formData.testManagementFlakinessEvaluationWindowDays, 10);
    if (Number.isNaN(windowDays) || windowDays < 1) {
      return {
        status: 400,
        error: 'Test management evaluation window must be a number of days greater than 0',
      };
    }
    tm.flakinessEvaluationWindowDays = windowDays;
  }

  return null;
}
