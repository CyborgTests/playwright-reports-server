import type { LlmTaskRow } from '../../service/db/llmTasks.sqlite.js';
import { llmTasksDb } from '../../service/db/llmTasks.sqlite.js';
import { service } from '../../service/index.js';
import { llmService } from '../index.js';
import { LLMProviderError } from '../types/index.js';
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

  static getInstance(): LlmAnalysisQueue {
    if (!LlmAnalysisQueue.instance) {
      LlmAnalysisQueue.instance = new LlmAnalysisQueue();
    }
    return LlmAnalysisQueue.instance;
  }

  private async getParallelRequests(): Promise<number> {
    try {
      const config = await service.getConfig();
      return config.llm?.parallelRequests ?? 1;
    } catch {
      return 1;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[llmQueue] Starting queue processor');
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[llmQueue] Stopped queue processor');
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      if (llmService.isConfigured() && !llmService.isCircuitOpen()) {
        this.maxParallel = await this.getParallelRequests();
        while (this.running && this.activeTasks < this.maxParallel) {
          if (!this.fillSlot()) break;
        }
      }
    } catch (error) {
      console.error('[llmQueue] Poll error:', error);
    }

    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
  }

  private fillSlot(): boolean {
    if (!this.running) return false;
    const [task] = llmTasksDb.claimNext(1);
    if (!task) return false;
    this.activeTasks++;
    this.dispatch(task);
    return true;
  }

  private dispatch(task: LlmTaskRow): void {
    void this.processTask(task)
      .catch((error) => {
        console.error(`[llmQueue] Unhandled error in task ${task.id}:`, error);
      })
      .finally(() => {
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
          `[llmQueue] Task ${task.id} requeued — LLM circuit open (${task.retryCount + 1}/${CIRCUIT_OPEN_MAX_REQUEUES})`
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
