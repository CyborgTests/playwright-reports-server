import type { LlmTaskType } from '@playwright-reports/shared';
import { isRootCauseCategory } from '../../service/test-management/index.js';
import { extractTestAnalysisFromMarkdown } from '../testAnalysis.js';

export interface DraftCheck {
  ok: boolean;
  reasons: string[];
}

const MIN_CONTENT_CHARS = 40;
const LINE_REPEAT_LIMIT = 5;
const MIN_LEXICAL_DIVERSITY = 0.15;
const LEXICAL_SAMPLE_MIN_WORDS = 80;

function looksDegenerate(text: string): boolean {
  const counts = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length < 12) continue;
    const next = (counts.get(line) ?? 0) + 1;
    if (next >= LINE_REPEAT_LIMIT) return true;
    counts.set(line, next);
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= LEXICAL_SAMPLE_MIN_WORDS) {
    const unique = new Set(words.map((w) => w.toLowerCase())).size;
    if (unique / words.length < MIN_LEXICAL_DIVERSITY) return true;
  }
  return false;
}

function checkCommon(content: string): string[] {
  const reasons: string[] = [];
  const text = content.trim();
  if (text.length < MIN_CONTENT_CHARS) reasons.push('output is empty or too short');
  if (looksDegenerate(text)) reasons.push('output is degenerate (repetition loop)');
  return reasons;
}

export function verifyDraft(taskType: LlmTaskType, content: string): DraftCheck {
  const reasons = checkCommon(content);

  if (taskType === 'test_analysis') {
    const { category } = extractTestAnalysisFromMarkdown(content);
    if (!category) reasons.push('missing required Category footer');
    else if (!isRootCauseCategory(category))
      reasons.push(`invalid root-cause category "${category}"`);
  }
  return { ok: reasons.length === 0, reasons };
}
