import type { LlmCircuitStatus } from '@playwright-reports/shared';
import { LLMProviderError } from './types/index.js';

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_COOLDOWN_MS = 60 * 1000;

type CircuitState = 'closed' | 'open' | 'half-open';

export class LLMCircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly label: string) {}

  shouldAttempt(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return false;
    // open: transition to half-open once the cooldown has elapsed.
    if (Date.now() - this.openedAt >= CIRCUIT_OPEN_COOLDOWN_MS) {
      this.state = 'half-open';
      return true;
    }
    return false;
  }

  msUntilRetry(): number {
    if (this.state !== 'open') return 0;
    return Math.max(0, CIRCUIT_OPEN_COOLDOWN_MS - (Date.now() - this.openedAt));
  }

  isBlocking(): boolean {
    if (this.state === 'half-open') return true;
    if (this.state === 'open') return Date.now() - this.openedAt < CIRCUIT_OPEN_COOLDOWN_MS;
    return false;
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state !== 'closed') {
      console.log(`[llm] circuit breaker closed for ${this.label} after successful call`);
    }
    this.state = 'closed';
  }

  onFailure(err: unknown): void {
    if (!isTransportFailure(err)) return;
    this.consecutiveFailures += 1;
    if (this.state === 'half-open') {
      this.trip();
      return;
    }
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.trip();
    }
  }

  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  getStatus(): LlmCircuitStatus {
    if (this.state === 'open' && this.isBlocking()) {
      return { state: 'open', retryInMs: this.msUntilRetry() };
    }
    if (this.state !== 'closed') return { state: 'half-open', retryInMs: null };
    return { state: 'closed', retryInMs: null };
  }

  private trip(): void {
    if (this.state !== 'open') {
      console.warn(
        `[llm] circuit breaker opened for ${this.label} after ${this.consecutiveFailures} consecutive failures; cooling down for ${CIRCUIT_OPEN_COOLDOWN_MS}ms`
      );
    }
    this.state = 'open';
    this.openedAt = Date.now();
  }
}

function isTransportFailure(err: unknown): boolean {
  if (!(err instanceof LLMProviderError)) return false;
  return err.code === 'network' || err.code === 'timeout' || err.code === 'server_error';
}

const breakers = new Map<string, LLMCircuitBreaker>();

export function circuitFor(modelId: string, label = modelId): LLMCircuitBreaker {
  let breaker = breakers.get(modelId);
  if (!breaker) {
    breaker = new LLMCircuitBreaker(label);
    breakers.set(modelId, breaker);
  }
  return breaker;
}

export function circuitStatusFor(modelId: string): LlmCircuitStatus {
  return breakers.get(modelId)?.getStatus() ?? { state: 'closed', retryInMs: null };
}

export function resetCircuit(modelId: string): void {
  breakers.get(modelId)?.reset();
}

export function deleteCircuit(modelId: string): void {
  breakers.delete(modelId);
}
