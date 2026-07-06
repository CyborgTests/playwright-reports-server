import type { LlmTaskType } from '@playwright-reports/shared';
import type { PromptSegment, SegmentedPrompt } from '../types/index.js';
import { assembleSegments, buildSegment } from './assembleSegments.js';

export interface Draft {
  content: string;
  model: string;
  baseUrl: string;
}

export const DEFAULT_SYNTHESIZER_DIRECTIVE = `You are given multiple independent answers to the SAME task above, each in a <candidate> block. Produce ONE final answer that follows the task's output format exactly. Rules: (1) Ground every claim in the task's evidence above - include a claim only if that evidence supports it, even when a candidate asserts otherwise. (2) When candidates conflict, keep the version the evidence supports; if the evidence is silent, keep the more specific, more cautious claim and drop the speculative one. (3) If the task ends in a label or classification, re-derive it yourself from the evidence - do NOT inherit it from the candidates' agreement, since they can share the same mistake. (4) Merge complementary insights and remove redundancy. (5) Do not introduce claims absent from every candidate unless they follow directly from the evidence. (6) Never mention that multiple candidates, drafts, or a synthesis step existed. Output ONLY the final answer, following EXACTLY the output format, sections, and constraints specified earlier in this prompt.`;
export const DEFAULT_JUDGE_DIRECTIVE = `The <candidate> answers above each address the SAME task and appear in RANDOM order - position is meaningless, so judge each on its own merits, not relative to the others. Score every candidate on this calibrated [0,1] scale for correctness, completeness, and adherence to the task's required output format: 0.00 = wrong, empty, or unusable; 0.25 = major errors or large gaps; 0.50 = partially correct but missing or misstating key points; 0.75 = correct and complete with only minor flaws; 1.00 = fully correct, complete, and correctly formatted. If the task requires a final label or classification, its correctness is decisive: when the label is wrong or contradicts the candidate's own reasoning or the evidence, score 0.50 or below however well-written the rest is. Do NOT reward length or verbosity - a concise correct answer scores at least as high as a verbose one that says the same thing. Set "pass" to true exactly when score >= 0.60. Use two decimals and include exactly one object per candidate. Respond with ONLY a JSON array inside a single \`\`\`json fenced block and nothing before or after it, e.g. [{"candidate": 1, "pass": true, "score": 0.75, "reason": "..."}]. "candidate" is the 1-based index as listed above.`;
export const DEFAULT_CRITIQUE_DIRECTIVE = `Critique the <draft> above as an answer to this task, judging it against the evidence and the task's requirements. Identify only REAL, material problems: factual errors, claims unsupported by the evidence, missing required points, output-format violations, or a final label/classification that contradicts the draft's own reasoning or the evidence. For each, name the specific issue and why it is wrong, ordered most to least severe. Be precise, not pedantic - do NOT invent problems, raise stylistic nitpicks, or flag correct content. If the draft is already correct, complete, and properly formatted, reply with exactly: NO MATERIAL ISSUES. Do NOT rewrite or restate the draft - only critique it.`;
export const DEFAULT_REVISE_DIRECTIVE = `Revise the <draft> above using the <critique>. Apply only the critique points that are correct and supported by the evidence; ignore any that are wrong, speculative, or merely stylistic. Preserve everything the draft already got right, and do not add claims the evidence does not support. If the critique reports no valid issue (e.g. "NO MATERIAL ISSUES"), return the draft unchanged. Output ONLY the improved final answer, following EXACTLY the output format, sections, and constraints specified earlier in this prompt.`;
export const DEFAULT_REANSWER_DIRECTIVE = `Answer the task above from scratch, using the original evidence. The <review_notes> list problems found in an earlier attempt at this task - treat them as things to check and avoid, NOT as conclusions to adopt. Do not assume the earlier attempt's framing or label was right; reach your own answer from the evidence. Output ONLY the final answer, following EXACTLY the output format, sections, and constraints specified earlier in this prompt.`;
export const DEFAULT_SCORER_DIRECTIVE = `Rate the <draft> above as an answer to this task on this calibrated [0,1] scale for correctness, completeness, and adherence to the required output format: 0.00 = wrong, empty, or unusable; 0.25 = major errors or large gaps; 0.50 = partially correct but missing or misstating key points; 0.75 = correct and complete with only minor flaws; 1.00 = fully correct, complete, and correctly formatted. If the task requires a final label or classification, its correctness is decisive: when the label is wrong or contradicts the draft's own reasoning or the evidence, score 0.50 or below however well-written the rest is. Judge substance, not length. Use two decimals. Respond with ONLY a JSON object inside a single \`\`\`json fenced block and nothing before or after it, e.g. {"score": 0.75}.`;

const TASK_VERIFY_ADDENDA: Partial<Record<LlmTaskType, string>> = {
  test_analysis: ` For the closing Category line specifically, watch these boundaries: an app correctly rejecting a bad request (a 401/403, a redirect to sign-in, a validation error on bad input) is NOT app_bug - it is environment or test_bug; expired or invalid auth and missing fixtures are environment, not app_bug; a click or wait that times out on an element the page snapshot shows as present, with auth/permission errors in the console, is more likely test_bug or environment than slow_path. A Category that ignores these signals is a wrong label.`,
};

export const LENS_PRESETS: Record<string, string> = {
  app: 'Investigate this as if the application under test is at fault. Build the strongest evidence-based case that the app produced a wrong result, then state it.',
  test: 'Investigate this as if the test code or the test environment is at fault - a bad selector, a missing wait, a wrong assumption, stale fixtures, or expired auth. Build the strongest evidence-based case for that.',
  environment:
    'Investigate this as if the environment is at fault - missing data, stale fixtures, expired or misconfigured auth, an unavailable dependency, or a runner/browser/network problem. Build the strongest evidence-based case for that.',
  skeptic:
    'Investigate this as a skeptic: prefer the dull, most common explanation, discount noisy or irrelevant signals (third-party/tracker requests, unrelated console warnings), and do not blame the application unless the evidence is direct.',
};

export function buildAuthorLensPrompt(original: SegmentedPrompt, lens: string): SegmentedPrompt {
  const text = LENS_PRESETS[lens] ?? lens;
  const seg = buildSegment(
    'author_lens',
    'user',
    false,
    `<perspective>\n${text}\nThis is your starting angle, not a forced conclusion - follow the evidence, and still produce the exact output format required above.\n</perspective>`
  );
  return assembleSegments([...original.segments, seg]);
}

const directiveOr = (override: string | undefined, fallback: string): string => {
  const t = override?.trim();
  return t && t.length > 0 ? t : fallback;
};

const withAddendum = (directive: string, taskType: LlmTaskType): string =>
  `${directive}${TASK_VERIFY_ADDENDA[taskType] ?? ''}`;

function draftSegments(drafts: Draft[]): Array<PromptSegment | null> {
  return drafts.map((d, i) =>
    buildSegment(
      `candidate_${i + 1}`,
      'user',
      false,
      `<candidate index="${i + 1}">\n${d.content}\n</candidate>`
    )
  );
}

export function buildSynthesizerPrompt(
  original: SegmentedPrompt,
  drafts: Draft[],
  directive?: string
): SegmentedPrompt {
  const seg = buildSegment(
    'synthesizer_directive',
    'user',
    false,
    `<synthesis_task>\n${directiveOr(directive, DEFAULT_SYNTHESIZER_DIRECTIVE)}\n</synthesis_task>`
  );
  return assembleSegments([...original.segments, ...draftSegments(drafts), seg]);
}

export function buildJudgePrompt(
  original: SegmentedPrompt,
  drafts: Draft[],
  taskType: LlmTaskType,
  directive?: string
): SegmentedPrompt {
  const seg = buildSegment(
    'judge_directive',
    'user',
    false,
    `<judge_task>\n${withAddendum(directiveOr(directive, DEFAULT_JUDGE_DIRECTIVE), taskType)}\n</judge_task>`
  );
  return assembleSegments([...original.segments, ...draftSegments(drafts), seg]);
}

export function buildCritiquePrompt(
  original: SegmentedPrompt,
  draft: string,
  directive?: string
): SegmentedPrompt {
  const segs = [
    buildSegment('candidate_1', 'user', false, `<draft>\n${draft}\n</draft>`),
    buildSegment(
      'critique_directive',
      'user',
      false,
      `<critique_task>\n${directiveOr(directive, DEFAULT_CRITIQUE_DIRECTIVE)}\n</critique_task>`
    ),
  ];
  return assembleSegments([...original.segments, ...segs]);
}

export function buildRevisePrompt(
  original: SegmentedPrompt,
  draft: string,
  critique: string,
  directive?: string
): SegmentedPrompt {
  const segs = [
    buildSegment('candidate_1', 'user', false, `<draft>\n${draft}\n</draft>`),
    buildSegment('critique', 'user', false, `<critique>\n${critique}\n</critique>`),
    buildSegment(
      'revise_directive',
      'user',
      false,
      `<revise_task>\n${directiveOr(directive, DEFAULT_REVISE_DIRECTIVE)}\n</revise_task>`
    ),
  ];
  return assembleSegments([...original.segments, ...segs]);
}

export function buildReanswerPrompt(
  original: SegmentedPrompt,
  critique: string,
  directive?: string
): SegmentedPrompt {
  const segs = [
    buildSegment('review_notes', 'user', false, `<review_notes>\n${critique}\n</review_notes>`),
    buildSegment(
      'reanswer_directive',
      'user',
      false,
      `<reanswer_task>\n${directiveOr(directive, DEFAULT_REANSWER_DIRECTIVE)}\n</reanswer_task>`
    ),
  ];
  return assembleSegments([...original.segments, ...segs]);
}

export function buildScorerPrompt(
  original: SegmentedPrompt,
  draft: string,
  taskType: LlmTaskType,
  directive?: string
): SegmentedPrompt {
  const segs = [
    buildSegment('candidate_1', 'user', false, `<draft>\n${draft}\n</draft>`),
    buildSegment(
      'scorer_directive',
      'user',
      false,
      `<scoring_task>\n${withAddendum(directiveOr(directive, DEFAULT_SCORER_DIRECTIVE), taskType)}\n</scoring_task>`
    ),
  ];
  return assembleSegments([...original.segments, ...segs]);
}
