import { EventEmitter } from 'node:events';
import type { LlmTaskRow } from './db/llmTasks.sqlite.js';

/**
 * Process-local pub/sub for LLM task transitions. Emits `task:{id}` per-task
 * and a global `task` on terminal status writes. Subscribed to by the SSE
 * `/api/llm/task-progress/:id` endpoint.
 */
class LlmTaskEvents extends EventEmitter {
  emitTaskUpdate(row: LlmTaskRow): void {
    this.emit(`task:${row.id}`, row);
    this.emit('task', row);
  }
}

const symbol = Symbol.for('playwright.reports.llmTaskEvents');
const g = globalThis as typeof globalThis & { [symbol]?: LlmTaskEvents };

if (!g[symbol]) {
  g[symbol] = new LlmTaskEvents();
}
export const llmTaskEvents: LlmTaskEvents = g[symbol];
// Many SSE clients can subscribe to the same task; bump the listener cap.
llmTaskEvents.setMaxListeners(100);
