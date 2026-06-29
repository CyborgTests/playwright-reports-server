import {
  type LlmTaskType,
  MIN_ESTIMATE_SAMPLES,
  parentEstimateKey,
  type QueueEtaEstimate,
  strategyEstimateKey,
} from '@playwright-reports/shared';
import { llmModelsDb, llmTasksDb } from '../service/db/index.js';
import { llmAnalysisQueue } from './queue/queue.js';
import { resolveGate } from './registry.js';
import { resolveOneShotModelRow, resolveRouting } from './routing/index.js';

interface EtaTypePlan {
  meanMs: number;
  gateKey: string;
  gateLimit: number;
}

// Estimated time to drain the queue
export function computeQueueEta(): QueueEtaEstimate {
  const scheduled = llmTasksDb.getScheduledForEta();
  if (scheduled.length === 0) return { etaMs: null, estimatedTasks: 0, totalScheduled: 0 };

  const estimates = llmTasksDb.getDurationEstimates(MIN_ESTIMATE_SAMPLES);
  const parallelism = Math.max(1, llmAnalysisQueue.parallelism());
  const now = Date.now();

  const gates = new Map<string, { work: number; limit: number }>();
  let estimatedTasks = 0;

  const planByType = new Map<LlmTaskType, EtaTypePlan | null>();
  const planFor = (type: LlmTaskType): EtaTypePlan | null => {
    const routing = resolveRouting(type);
    const oneShot = routing.strategy === 'one_shot';
    const model = oneShot ? resolveOneShotModelRow(type) : (llmModelsDb.getPrimary() ?? null);

    let meanMs: number | undefined;
    if (oneShot && model) {
      meanMs = estimates.parents[parentEstimateKey(type, 'one_shot', model.model, model.baseUrl)]
        ?.meanMs;
    }
    meanMs ??= estimates.parentsByStrategy[strategyEstimateKey(type, routing.strategy)]?.meanMs;
    if (meanMs == null) return null;

    const gate = model ? resolveGate(model) : { key: '__default__', limit: parallelism };
    return { meanMs, gateKey: gate.key, gateLimit: Math.max(1, gate.limit) };
  };

  for (const task of scheduled) {
    let plan = planByType.get(task.type);
    if (plan === undefined) {
      plan = planFor(task.type);
      planByType.set(task.type, plan);
    }
    if (!plan) continue;

    estimatedTasks++;
    const remaining =
      task.status === 'processing' && task.startedAt
        ? Math.max(plan.meanMs - (now - Date.parse(task.startedAt)), 0)
        : plan.meanMs;

    const acc = gates.get(plan.gateKey) ?? { work: 0, limit: plan.gateLimit };
    acc.work += remaining;
    gates.set(plan.gateKey, acc);
  }

  if (estimatedTasks === 0) {
    return { etaMs: null, estimatedTasks: 0, totalScheduled: scheduled.length };
  }

  let etaMs = 0;
  for (const gate of gates.values()) etaMs = Math.max(etaMs, gate.work / gate.limit);
  return { etaMs: Math.round(etaMs), estimatedTasks, totalScheduled: scheduled.length };
}
