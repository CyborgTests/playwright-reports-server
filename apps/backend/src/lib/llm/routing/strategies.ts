import type { LlmTaskRouting, LlmTaskType } from '@playwright-reports/shared';
import { configCache } from '../../service/cache/config.js';
import type { SegmentedSendOptions } from '../index.js';
import {
  buildCritiquePrompt,
  buildJudgePrompt,
  buildRevisePrompt,
  buildScorerPrompt,
  buildSynthesizerPrompt,
} from '../prompts/routing.js';
import { fitToContextWindow } from '../queue/tasks/promptFitting.js';
import { type FallbackSendResult, sendWithFallback } from '../registry.js';
import type { LLMResponse, SegmentedPrompt } from '../types/index.js';
import {
  callRole,
  coerceVerdicts,
  fitFinal,
  parseFirstJson,
  RESERVE,
  resolveRole,
  resolveRoles,
  runAuthors,
  SCORE_RESERVE,
  type Usage,
} from './shared.js';
import { verifyDraft } from './verify.js';

const SCORE_TIE_EPSILON = 0.05;
function shuffleIndices(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export async function runFusion(
  taskId: string | null,
  taskType: LlmTaskType,
  prompt: SegmentedPrompt,
  routing: LlmTaskRouting
): Promise<FallbackSendResult> {
  const authors = resolveRoles(routing.authors, taskType);
  const { drafts, usages } = await runAuthors(taskId, taskType, prompt, authors);
  const synth = resolveRole(routing.synthesizer, taskType) ?? resolveRole(undefined, taskType);

  if (synth) {
    try {
      const { prompt: fitted } = await fitToContextWindow(
        buildSynthesizerPrompt(prompt, drafts, configCache.config?.llm?.customSynthesizerPrompt),
        RESERVE[taskType]
      );
      const resp = await callRole(taskId, taskType, 'synthesizer', synth, fitted);
      return fitFinal(resp, [...usages, resp.usage], synth.row.baseUrl);
    } catch {
      // degrade to the best (first successful) draft
    }
  }
  const best = drafts[0];
  return fitFinal(
    { content: best.content, model: best.model, usage: { inputTokens: 0, outputTokens: 0 } },
    usages,
    best.baseUrl
  );
}

export async function runCouncil(
  taskId: string | null,
  taskType: LlmTaskType,
  prompt: SegmentedPrompt,
  routing: LlmTaskRouting
): Promise<FallbackSendResult> {
  const authors = resolveRoles(routing.authors, taskType);
  const { drafts, usages } = await runAuthors(taskId, taskType, prompt, authors);
  const judges = resolveRoles(routing.judges, taskType);
  const n = drafts.length;
  const customJudge = configCache.config?.llm?.customJudgePrompt;

  // Position-bias mitigation: each judge sees the candidates in an INDEPENDENT
  // random order (built + fitted per judge), then we map every verdict back to the
  // original draft index before tallying.
  const judgeRuns = await Promise.allSettled(
    judges.map(async (j) => {
      const order = shuffleIndices(n); // presentedPos -> originalIndex
      const { prompt: judgePrompt } = await fitToContextWindow(
        buildJudgePrompt(
          prompt,
          order.map((oi) => drafts[oi]),
          customJudge
        ),
        SCORE_RESERVE
      );
      const resp = await callRole(taskId, taskType, 'judge', j, judgePrompt);
      return { resp, order, judgeModel: j.row.model };
    })
  );

  // Self-preference bias: a judge tends to favor a draft from its OWN model. We
  // tally foreign-judge verdicts (judge model != draft model) and self-verdicts
  // separately, then fold a draft's self-verdicts back in ONLY if no foreign judge
  // scored it - so the filter never leaves a draft unjudged.
  const judgeUsages: Usage[] = [];
  const votes = new Array(n).fill(0); // votes[i] = pass count for draft i
  const scores: number[][] = drafts.map(() => []); // scores[i] = scores for draft i
  const foreignCount = new Array(n).fill(0);
  const selfVotes = new Array(n).fill(0);
  const selfScores: number[][] = drafts.map(() => []);

  for (const run of judgeRuns) {
    if (run.status !== 'fulfilled') continue;
    const { resp, order, judgeModel } = run.value;
    judgeUsages.push(resp.usage);
    for (const v of coerceVerdicts(parseFirstJson(resp.content))) {
      const presented = (v.candidate ?? 0) - 1;
      if (presented < 0 || presented >= order.length) continue;
      const idx = order[presented];
      const isSelf = drafts[idx].model === judgeModel;
      if (isSelf) {
        if (v.pass) selfVotes[idx] += 1;
        if (typeof v.score === 'number') selfScores[idx].push(v.score);
      } else {
        foreignCount[idx] += 1;
        if (v.pass) votes[idx] += 1;
        if (typeof v.score === 'number') scores[idx].push(v.score);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (foreignCount[i] === 0) {
      votes[i] += selfVotes[i];
      scores[i].push(...selfScores[i]);
    }
  }

  const meanScore = (i: number) =>
    scores[i].length ? scores[i].reduce((a, b) => a + b, 0) / scores[i].length : 0;
  const minPassVotes = Math.min(
    routing.minPassVotes ?? Math.ceil(judges.length / 2),
    Math.max(1, judges.length)
  );

  const passing = drafts.map((_, i) => i).filter((i) => votes[i] >= minPassVotes);
  const pool = passing.length > 0 ? passing : drafts.map((_, i) => i);

  const topMean = Math.max(...pool.map(meanScore));
  const tied = pool.filter((i) => meanScore(i) >= topMean - SCORE_TIE_EPSILON);
  const winner = tied.reduce(
    (best, i) => (drafts[i].content.length < drafts[best].content.length ? i : best),
    tied[0]
  );

  const best = drafts[winner];
  const allUsages = [...usages, ...judgeUsages];
  return fitFinal(
    { content: best.content, model: best.model, usage: { inputTokens: 0, outputTokens: 0 } },
    allUsages,
    best.baseUrl
  );
}

export async function runCascade(
  taskId: string | null,
  taskType: LlmTaskType,
  prompt: SegmentedPrompt,
  routing: LlmTaskRouting
): Promise<FallbackSendResult> {
  const tiers = resolveRoles(routing.tiers, taskType);
  const gate = routing.cascadeGate ?? 'checks_and_scorer';
  const useChecks = gate !== 'scorer';
  const useScorer = gate !== 'checks';
  const scorer = useScorer
    ? (resolveRole(routing.scorer, taskType) ?? resolveRole(undefined, taskType))
    : null;
  const threshold = routing.escalateBelowScore ?? 0.7;
  const usages: Usage[] = [];
  let lastErr: unknown;

  for (let i = 0; i < tiers.length; i++) {
    const isLast = i === tiers.length - 1;
    let draft: LLMResponse;
    try {
      draft = await callRole(taskId, taskType, 'tier', tiers[i], prompt);
    } catch (err) {
      lastErr = err;
      continue; // tier failed → escalate
    }
    usages.push(draft.usage);
    if (isLast) {
      return fitFinal(draft, usages, tiers[i].row.baseUrl);
    }

    // Primary gate (skipped when cascadeGate is 'scorer')
    if (useChecks) {
      const check = verifyDraft(taskType, draft.content);
      if (!check.ok) {
        console.warn(
          `[llm-routing] cascade tier ${i + 1} for ${taskType} failed deterministic checks (${check.reasons.join('; ')}); escalating`
        );
        continue;
      }
    }

    const scorerFailureScore = gate === 'scorer' ? 0 : 1;
    let score = 1;
    if (useScorer && scorer) {
      try {
        const { prompt: sp } = await fitToContextWindow(
          buildScorerPrompt(prompt, draft.content, configCache.config?.llm?.customScorerPrompt),
          SCORE_RESERVE
        );
        const sResp = await callRole(taskId, taskType, 'scorer', scorer, sp);
        usages.push(sResp.usage);
        const parsed = parseFirstJson(sResp.content) as { score?: number } | null;
        if (parsed && typeof parsed.score === 'number') {
          score = parsed.score;
        } else {
          score = scorerFailureScore;
          console.warn(
            `[llm-routing] cascade scorer for ${taskType} returned no parsable score; ${
              scorerFailureScore >= threshold ? 'accepting' : 'escalating'
            } tier ${i + 1}`
          );
        }
      } catch {
        score = scorerFailureScore; // unevaluable scorer: accept (checks_and_scorer) or escalate (scorer-only)
      }
      console.info(
        `[llm-routing] cascade tier ${i + 1} for ${taskType} scored ${score.toFixed(2)} (threshold ${threshold}) → ${score >= threshold ? 'accept' : 'escalate'}`
      );
    }
    if (score >= threshold) {
      return fitFinal(draft, usages, tiers[i].row.baseUrl);
    }
  }
  throw lastErr ?? new Error('all cascade tiers failed');
}

export async function runSelfRefine(
  taskId: string | null,
  taskType: LlmTaskType,
  prompt: SegmentedPrompt,
  routing: LlmTaskRouting,
  options: SegmentedSendOptions
): Promise<FallbackSendResult> {
  const author = resolveRoles(routing.authors, taskType)[0];
  if (!author) return sendWithFallback(prompt, options);
  const critic = resolveRole(routing.critic, taskType) ?? author;
  const reviser = resolveRole(routing.reviser, taskType) ?? author;
  const maxRounds = Math.max(1, routing.maxRounds ?? 1);

  const usages: Usage[] = [];
  let draft = await callRole(taskId, taskType, 'author', author, prompt);
  usages.push(draft.usage);
  let baseUrl = author.row.baseUrl;

  for (let round = 0; round < maxRounds; round++) {
    try {
      const critique = await callRole(
        taskId,
        taskType,
        'critic',
        critic,
        buildCritiquePrompt(prompt, draft.content, configCache.config?.llm?.customCritiquePrompt)
      );
      usages.push(critique.usage);
      const { prompt: revisePrompt } = await fitToContextWindow(
        buildRevisePrompt(
          prompt,
          draft.content,
          critique.content,
          configCache.config?.llm?.customRevisePrompt
        ),
        RESERVE[taskType]
      );
      const revised = await callRole(taskId, taskType, 'reviser', reviser, revisePrompt);
      usages.push(revised.usage);
      draft = revised;
      baseUrl = reviser.row.baseUrl;
    } catch {
      break; // degrade: keep the last good draft
    }
  }
  return fitFinal(draft, usages, baseUrl);
}
