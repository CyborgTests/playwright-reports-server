import {
  type LlmTaskType,
  MIN_ESTIMATE_SAMPLES,
  parentEstimateKey,
  type QueueEtaEstimate,
  strategyEstimateKey,
} from '@playwright-reports/shared';
import { llmModelsDb, llmTasksDb } from '../service/db/index.js';
import type { ScheduledEtaTask } from '../service/db/llmTasks.sqlite.js';
import { llmAnalysisQueue } from './queue/queue.js';
import { resolveGate } from './registry.js';
import { resolveOneShotModelRow, resolveRouting } from './routing/index.js';

interface EtaTypePlan {
  meanMs: number;
  gateKey: string;
  gateLimit: number;
}

export interface QueueEtas {
  overall: QueueEtaEstimate;
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

export function computeQueueEta(): QueueEtaEstimate {
  return computeQueueEtas().overall;
}

export function getTaskEtaMs(taskId: string): number | null {
  return computeQueueEtas().perTask.get(taskId) ?? null;
}

export function getReportEtaMs(reportId: string): number | null {
  return computeQueueEtas().byReport.get(reportId) ?? null;
}

export function getProjectEtaMs(project: string): number | null {
  return computeQueueEtas().byProject.get(project) ?? null;
}

function simulate(now: number): QueueEtas {
  const scheduled = llmTasksDb.getScheduledForEta();
  const empty: QueueEtas = {
    overall: { etaMs: null, estimatedTasks: 0, totalScheduled: scheduled.length },
    perTask: new Map(),
    byReport: new Map(),
    byProject: new Map(),
  };
  if (scheduled.length === 0) return empty;

  const estimates = llmTasksDb.getDurationEstimates(MIN_ESTIMATE_SAMPLES);
  const parallelism = Math.max(1, llmAnalysisQueue.parallelism());

  const planByType = new Map<LlmTaskType, EtaTypePlan | null>();
  const planFor = (type: LlmTaskType): EtaTypePlan | null => {
    const cached = planByType.get(type);
    if (cached !== undefined) return cached;
    const routing = resolveRouting(type);
    const oneShot = routing.strategy === 'one_shot';
    const model = oneShot ? resolveOneShotModelRow(type) : (llmModelsDb.getPrimary() ?? null);

    let meanMs: number | undefined;
    if (oneShot && model) {
      meanMs =
        estimates.parents[parentEstimateKey(type, 'one_shot', model.model, model.baseUrl)]?.meanMs;
    }
    meanMs ??= estimates.parentsByStrategy[strategyEstimateKey(type, routing.strategy)]?.meanMs;

    let plan: EtaTypePlan | null = null;
    if (meanMs != null) {
      const gate = model ? resolveGate(model) : { key: '__default__', limit: parallelism };
      plan = { meanMs, gateKey: gate.key, gateLimit: Math.max(1, gate.limit) };
    }
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

  const place = (
    gateKey: string,
    gateLimit: number,
    remainingMs: number,
    earliestStartMs: number
  ): number => {
    let lanes = lanesByGate.get(gateKey);
    if (!lanes) {
      lanes = new Array<number>(gateLimit).fill(0);
      lanesByGate.set(gateKey, lanes);
    } else {
      while (lanes.length < gateLimit) lanes.push(0);
    }
    let earliestLaneIndex = 0;
    for (let index = 1; index < lanes.length; index++) {
      if (lanes[index] < lanes[earliestLaneIndex]) earliestLaneIndex = index;
    }
    const finish = Math.max(lanes[earliestLaneIndex], earliestStartMs) + remainingMs;
    lanes[earliestLaneIndex] = finish;
    if (finish > overallMs) overallMs = finish;
    return finish;
  };

  const record = (task: ScheduledEtaTask, finish: number) => {
    estimatedTasks++;
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

  const remainingMsFor = (task: ScheduledEtaTask, meanMs: number): number =>
    task.status === 'processing' && task.startedAt
      ? Math.max(meanMs - (now - Date.parse(task.startedAt)), 0)
      : meanMs;

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
    if (!plan) continue;
    const earliestStartMs = task.status === 'processing' ? 0 : earliestStartFor(task);
    record(
      task,
      place(plan.gateKey, plan.gateLimit, remainingMsFor(task, plan.meanMs), earliestStartMs)
    );
  }

  return {
    overall: {
      etaMs: estimatedTasks === 0 ? null : Math.round(overallMs),
      estimatedTasks,
      totalScheduled: scheduled.length,
    },
    perTask,
    byReport,
    byProject,
  };
}
