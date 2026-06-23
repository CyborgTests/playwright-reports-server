import { type LlmTaskRow, llmModelsDb, llmTasksDb } from '../../service/db/index.js';
import { llmTaskEvents } from '../../service/llmTaskEvents.js';
import { llmService } from '../index.js';
import { type GateReservation, modelGate, reservationStore } from '../modelGate.js';
import { isFallbackChainEnabled, isLlmFeatureEnabled, resolveGate } from '../registry.js';
import { resolveRouting } from '../routing/index.js';
import { LLMProviderError } from '../types/index.js';
import { resolveScreenshotModel } from '../visionTranscribe.js';
import { processProjectSummary } from './tasks/projectSummary.js';
import { processReportSummary } from './tasks/reportSummary.js';
import { processTestAnalysis } from './tasks/testAnalysis.js';

const CIRCUIT_OPEN_MAX_REQUEUES = 20;

class LlmAnalysisQueue {
  private static instance: LlmAnalysisQueue;
  private running = false;
  private pollIntervalMs = 5000;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTasks = 0;
  private maxParallel = 1;
  private cachedBudget: number | null = null;
  private readonly onEnqueue = (): void => this.kick();

  static getInstance(): LlmAnalysisQueue {
    if (!LlmAnalysisQueue.instance) {
      LlmAnalysisQueue.instance = new LlmAnalysisQueue();
    }
    return LlmAnalysisQueue.instance;
  }

  private getParallelRequests(): number {
    const enabled = llmModelsDb.list().filter((m) => m.enabled === 1);
    const budgets = new Map<string, number>();
    for (const m of enabled) {
      const gate = resolveGate(m);
      budgets.set(gate.key, Math.max(1, gate.limit));
    }
    const total = [...budgets.values()].reduce((sum, n) => sum + n, 0);
    return Math.max(1, total);
  }

  private getBudget(): number {
    this.cachedBudget ??= this.getParallelRequests();
    return this.cachedBudget;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[llmQueue] Starting queue processor');
    llmTaskEvents.on('enqueue', this.onEnqueue);
    this.poll();
  }

  stop(): void {
    this.running = false;
    llmTaskEvents.off('enqueue', this.onEnqueue);
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[llmQueue] Stopped queue processor');
  }

  kick(): void {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.poll(), 0);
  }

  notifyConfigChanged(): void {
    this.cachedBudget = null;
    this.kick();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    this.pollTimer = null;

    let pending = false;
    try {
      const canProcess = isLlmFeatureEnabled() && llmService.isConfigured();
      if (canProcess && llmTasksDb.hasQueued()) {
        pending = true;
        const circuitOk = !llmService.isCircuitOpen() || isFallbackChainEnabled();
        if (circuitOk) {
          this.maxParallel = this.getBudget();
          while (this.running && this.activeTasks < this.maxParallel) {
            if (!this.fillSlot()) break;
          }
        }
      }
    } catch (error) {
      console.error('[llmQueue] Poll error:', error);
      pending = true;
    }

    if (this.running && (pending || this.activeTasks > 0)) {
      this.schedulePoll();
    } else {
      this.cachedBudget = null;
    }
  }

  private schedulePoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
  }

  private fillSlot(): boolean {
    if (!this.running) return false;
    const claim = llmTasksDb.claimNextRunnable((task) => this.decideStart(task));
    if (!claim) return false;
    this.activeTasks++;
    this.dispatch(claim.task, claim.reservation);
    return true;
  }

  private decideStart(task: LlmTaskRow): {
    run: boolean;
    reservation?: { gateKey: string; release: () => void };
  } {
    const routing = resolveRouting(task.type);
    if (routing.strategy !== 'one_shot') return { run: true };
    const primary = llmModelsDb.getPrimary();
    if (!primary) return { run: true };
    const overrideRow = routing.model?.modelId
      ? (llmModelsDb.list().find((m) => m.id === routing.model?.modelId && m.enabled === 1) ?? null)
      : null;
    const effective = overrideRow ?? primary;
    const gate = resolveGate(effective);
    if (task.type === 'test_analysis') {
      const screenshot = resolveScreenshotModel();
      if (screenshot && resolveGate(screenshot).key === gate.key) {
        return { run: true };
      }
    }
    const release = modelGate.tryAcquire(gate.key, gate.limit);
    return release ? { run: true, reservation: { gateKey: gate.key, release } } : { run: false };
  }

  private dispatch(task: LlmTaskRow, reservation?: { gateKey: string; release: () => void }): void {
    const ctx: GateReservation | null = reservation
      ? { gateKey: reservation.gateKey, consumed: false }
      : null;
    const run = ctx
      ? () => reservationStore.run(ctx, () => this.processTask(task))
      : () => this.processTask(task);
    void run()
      .catch((error) => {
        console.error(`[llmQueue] Unhandled error in task ${task.id}:`, error);
      })
      .finally(() => {
        reservation?.release();
        this.activeTasks--;
        if (this.running && this.activeTasks < this.maxParallel) {
          this.fillSlot();
        }
      });
  }

  private async processTask(task: LlmTaskRow): Promise<void> {
    try {
      switch (task.type) {
        case 'test_analysis':
          await processTestAnalysis(task);
          break;
        case 'report_summary':
          await processReportSummary(task);
          break;
        case 'project_summary':
          await processProjectSummary(task);
          break;
        default:
          llmTasksDb.fail(task.id, `Unknown task type: ${task.type}`);
      }
    } catch (error) {
      if (
        error instanceof LLMProviderError &&
        error.code === 'circuit_open' &&
        task.retryCount < CIRCUIT_OPEN_MAX_REQUEUES
      ) {
        llmTasksDb.requeueWithRetryIncrement(task.id);
        console.warn(
          `[llmQueue] Task ${task.id} requeued - LLM circuit open (${task.retryCount + 1}/${CIRCUIT_OPEN_MAX_REQUEUES})`
        );
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[llmQueue] Task ${task.id} failed:`, msg);
      llmTasksDb.fail(task.id, msg);
    }
  }
}

export const llmAnalysisQueue = LlmAnalysisQueue.getInstance();
