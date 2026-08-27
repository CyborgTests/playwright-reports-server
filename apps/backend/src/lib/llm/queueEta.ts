import {
  type LlmDurationEstimate,
  type LlmTaskType,
  MIN_ESTIMATE_SAMPLES,
  parentEstimateKey,
  type QueueEtaEstimate,
  strategyEstimateKey,
  strategyPeakConcurrency,
  strategySerialDepth,
} from '@playwright-reports/shared';
import { llmModelsDb, llmTasksDb } from '../service/db/index.js';
import type { ScheduledEtaTask } from '../service/db/llmTasks.sqlite.js';
import { type LaneGate, packGates } from './etaLanes.js';
import type { Gate } from './modelGate.js';
import { llmAnalysisQueue } from './queue/queue.js';
import { resolveGates } from './registry.js';
import { resolveOneShotModelRow, resolveRouting } from './routing/index.js';

interface EtaTypePlan {
  meanMs: number;
  measured: boolean;
  gates: Gate[];
  slots: number;
}

const DEFAULT_CALL_MS = 60_000;
const OVERRUN_REMAINDER_RATIO = 0.25;

function meanOverPrefix(
  table: Record<string, LlmDurationEstimate>,
  prefix: string
): number | undefined {
  let sum = 0;
  let count = 0;
  for (const [key, estimate] of Object.entries(table)) {
    if (!key.startsWith(prefix)) continue;
    sum += estimate.meanMs;
    count++;
  }
  return count > 0 ? sum / count : undefined;
}

export interface QueueEtas {
  overall: QueueEtaEstimate;
  computedAt: number; // the simulation's clock; every ms below is relative to it
  perTask: Map<string, number>; // taskId  -> ms until that task finishes
  byReport: Map<string, number>; // reportId -> ms until its last in-flight task finishes
  byProject: Map<string, number>; // project -> same, per project
}

const ETAS_TTL_MS = 1000;
let cache: { at: number; value: QueueEtas } | null = null;

export function computeQueueEtas(): QueueEtas {
  const now = Date.now();
  if (cache && now - cache.at < ETAS_TTL_MS) return cache.value;
  const value = simulate(now);
  cache = { at: now, value };
  return value;
}

function finishAt(etas: QueueEtas, ms: number | undefined): string | null {
  return ms == null ? null : new Date(etas.computedAt + ms).toISOString();
}

export function computeQueueEta(): QueueEtaEstimate {
  return computeQueueEtas().overall;
}

export function getTaskEtaFinishAt(taskId: string): string | null {
  const etas = computeQueueEtas();
  return finishAt(etas, etas.perTask.get(taskId));
}

export function getReportEtaFinishAt(reportId: string): string | null {
  const etas = computeQueueEtas();
  return finishAt(etas, etas.byReport.get(reportId));
}

export function getProjectEtaFinishAt(project: string): string | null {
  const etas = computeQueueEtas();
  return finishAt(etas, etas.byProject.get(project));
}

function simulate(now: number): QueueEtas {
  const scheduled = llmTasksDb.getScheduledForEta();
  const empty: QueueEtas = {
    overall: { etaFinishAt: null, estimatedTasks: 0, totalScheduled: scheduled.length },
    computedAt: now,
    perTask: new Map(),
    byReport: new Map(),
    byProject: new Map(),
  };
  if (scheduled.length === 0) return empty;

  const estimates = llmTasksDb.getDurationEstimates(MIN_ESTIMATE_SAMPLES);
  const parallelism = Math.max(1, llmAnalysisQueue.parallelism());

  const planByType = new Map<LlmTaskType, EtaTypePlan>();
  const planFor = (type: LlmTaskType): EtaTypePlan => {
    const cached = planByType.get(type);
    if (cached) return cached;
    const routing = resolveRouting(type);
    const oneShot = routing.strategy === 'one_shot';
    const model = oneShot ? resolveOneShotModelRow(type) : (llmModelsDb.getPrimary() ?? null);

    let meanMs: number | undefined;
    if (oneShot && model) {
      meanMs =
        estimates.parents[parentEstimateKey(type, 'one_shot', model.model, model.baseUrl)]?.meanMs;
    }
    meanMs ??= estimates.parentsByStrategy[strategyEstimateKey(type, routing.strategy)]?.meanMs;
    const measured = meanMs != null;
    meanMs ??=
      strategySerialDepth(routing) *
      (meanOverPrefix(estimates.roles, `${type}|`) ??
        meanOverPrefix(estimates.parents, `${type}|one_shot|`) ??
        DEFAULT_CALL_MS);

    const gates: Gate[] = model
      ? resolveGates(model).map((gate) => ({ key: gate.key, limit: Math.max(1, gate.limit) }))
      : [{ key: '__default__', limit: parallelism }];
    const tightest = Math.min(...gates.map((gate) => gate.limit));
    const plan: EtaTypePlan = {
      meanMs,
      measured,
      gates,
      slots: Math.min(strategyPeakConcurrency(routing), tightest),
    };
    planByType.set(type, plan);
    return plan;
  };

  const lanesByGate = new Map<string, number[]>();
  const perTask = new Map<string, number>();
  const byReport = new Map<string, number>();
  const byProject = new Map<string, number>();

  const reportTestAnalysisFinish = new Map<string, number>();
  const projectTestOrReportFinish = new Map<string, number>();
  let anyTestOrReportFinish = 0; // floor for a project_summary scoped to 'all'

  let estimatedTasks = 0;
  let overallMs = 0;

  const place = (plan: EtaTypePlan, remainingMs: number, earliestStartMs: number): number => {
    const laneGates: LaneGate[] = plan.gates.map((gate) => {
      let lanes = lanesByGate.get(gate.key);
      if (!lanes) {
        lanes = new Array<number>(gate.limit).fill(0);
        lanesByGate.set(gate.key, lanes);
      } else {
        while (lanes.length < gate.limit) lanes.push(0);
      }
      return { lanes, slots: plan.slots };
    });
    const finish = packGates(laneGates, remainingMs, earliestStartMs);
    if (finish > overallMs) overallMs = finish;
    return finish;
  };

  const record = (task: ScheduledEtaTask, finish: number, measured: boolean) => {
    if (measured) estimatedTasks++;
    perTask.set(task.id, finish);
    if (task.reportId) {
      byReport.set(task.reportId, Math.max(byReport.get(task.reportId) ?? 0, finish));
    }
    if (task.project) {
      byProject.set(task.project, Math.max(byProject.get(task.project) ?? 0, finish));
    }
    if (task.type === 'test_analysis' && task.reportId) {
      reportTestAnalysisFinish.set(
        task.reportId,
        Math.max(reportTestAnalysisFinish.get(task.reportId) ?? 0, finish)
      );
    }
    if (task.type === 'test_analysis' || task.type === 'report_summary') {
      if (task.project) {
        projectTestOrReportFinish.set(
          task.project,
          Math.max(projectTestOrReportFinish.get(task.project) ?? 0, finish)
        );
      }
      anyTestOrReportFinish = Math.max(anyTestOrReportFinish, finish);
    }
  };

  const earliestStartFor = (task: ScheduledEtaTask): number => {
    if (task.type === 'report_summary') {
      return task.reportId ? (reportTestAnalysisFinish.get(task.reportId) ?? 0) : 0;
    }
    if (task.type === 'project_summary') {
      return task.project === 'all'
        ? anyTestOrReportFinish
        : (projectTestOrReportFinish.get(task.project ?? '') ?? 0);
    }
    return 0;
  };

  const remainingMsFor = (task: ScheduledEtaTask, meanMs: number): number => {
    if (task.status !== 'processing' || !task.startedAt) return meanMs;
    const elapsed = now - Date.parse(task.startedAt);
    // 10% of the mean is the floor so the next items don't see eta 0 and treat the slot as free.
    return Math.max(meanMs - elapsed, meanMs * 0.1, elapsed * OVERRUN_REMAINDER_RATIO);
  };

  const dependencyTier = (task: ScheduledEtaTask): number =>
    task.type === 'test_analysis' ? 0 : task.type === 'report_summary' ? 1 : 2;

  const placementOrder = [
    ...scheduled.filter((task) => task.status === 'processing'),
    ...scheduled
      .filter((task) => task.status === 'queued')
      .sort(
        (a, b) =>
          dependencyTier(a) - dependencyTier(b) ||
          b.priority - a.priority ||
          a.createdAt.localeCompare(b.createdAt)
      ),
  ];

  for (const task of placementOrder) {
    const plan = planFor(task.type);
    const earliestStartMs = task.status === 'processing' ? 0 : earliestStartFor(task);
    record(task, place(plan, remainingMsFor(task, plan.meanMs), earliestStartMs), plan.measured);
  }

  return {
    overall: {
      etaFinishAt: new Date(now + Math.round(overallMs)).toISOString(),
      estimatedTasks,
      totalScheduled: scheduled.length,
    },
    computedAt: now,
    perTask,
    byReport,
    byProject,
  };
}
