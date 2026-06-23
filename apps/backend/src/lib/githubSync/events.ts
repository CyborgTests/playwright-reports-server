import { EventEmitter } from 'node:events';

class GithubSyncEvents extends EventEmitter {
  emitChanged(): void {
    this.emit('changed');
  }
}

const symbol = Symbol.for('playwright.reports.githubSyncEvents');
const g = globalThis as typeof globalThis & { [symbol]?: GithubSyncEvents };

if (!g[symbol]) {
  g[symbol] = new GithubSyncEvents();
}
export const githubSyncEvents: GithubSyncEvents = g[symbol];
githubSyncEvents.setMaxListeners(100);
