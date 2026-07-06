import { AsyncLocalStorage } from 'node:async_hooks';

interface TaskSignalContext {
  signal: AbortSignal;
}

const store = new AsyncLocalStorage<TaskSignalContext>();
const controllers = new Map<string, AbortController>();

export function registerRunningTask(taskId: string): AbortController {
  const controller = new AbortController();
  controllers.set(taskId, controller);
  return controller;
}

export function unregisterRunningTask(taskId: string): void {
  controllers.delete(taskId);
}

export function abortRunningTask(taskId: string): boolean {
  const controller = controllers.get(taskId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function runWithTaskSignal<T>(signal: AbortSignal, fn: () => T): T {
  return store.run({ signal }, fn);
}

export function getTaskSignal(): AbortSignal | undefined {
  return store.getStore()?.signal;
}
