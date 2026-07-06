import { EventEmitter } from 'node:events';

export type DataEntityKind = 'report' | 'result';

class DataEvents extends EventEmitter {
  emitChanged(kind: DataEntityKind): void {
    this.emit('changed', kind);
  }
}

const symbol = Symbol.for('playwright.reports.dataEvents');
const g = globalThis as typeof globalThis & { [symbol]?: DataEvents };

if (!g[symbol]) {
  g[symbol] = new DataEvents();
}
export const dataEvents: DataEvents = g[symbol];
dataEvents.setMaxListeners(100);
