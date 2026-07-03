import type { LlmCircuitStatus } from '@playwright-reports/shared';
import { LLMProviderError } from './types/index.js';

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_COOLDOWN_MS = 60 * 1000;
// A rate limit with no Retry-After header: back off this long before probing.
const RATE_LIMIT_DEFAULT_COOLDOWN_MS = 60 * 1000;

type CircuitState = 'closed' | 'open' | 'half-open';
type CircuitReason = 'failures' | 'rate_limit';

export class LLMCircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private cooldownMs = CIRCUIT_OPEN_COOLDOWN_MS;
  private reason: CircuitReason = 'failures';

  constructor(private readonly label: string) {}

  shouldAttempt(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return false;
    // open: transition to half-open once the cooldown has elapsed.
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
      return true;
    }
    return false;
  }

  msUntilRetry(): number {
    if (this.state !== 'open') return 0;
    return Math.max(0, this.cooldownMs - (Date.now() - this.openedAt));
  }

  isBlocking(): boolean {
    if (this.state === 'half-open') return true;
    if (this.state === 'open') return Date.now() - this.openedAt < this.cooldownMs;
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
    // honor the provider's 'Retry-After' header when present.
    if (err instanceof LLMProviderError && err.code === 'rate_limit') {
      this.trip(Math.max(1000, err.retryAfterMs ?? RATE_LIMIT_DEFAULT_COOLDOWN_MS), 'rate_limit');
      return;
    }
    if (!isTransportFailure(err)) return;
    this.consecutiveFailures += 1;
    if (this.state === 'half-open') {
      this.trip(CIRCUIT_OPEN_COOLDOWN_MS, 'failures');
      return;
    }
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.trip(CIRCUIT_OPEN_COOLDOWN_MS, 'failures');
    }
  }

  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.cooldownMs = CIRCUIT_OPEN_COOLDOWN_MS;
    this.reason = 'failures';
  }

  getStatus(): LlmCircuitStatus {
    if (this.state === 'open' && this.isBlocking()) {
      return { state: 'open', retryInMs: this.msUntilRetry(), reason: this.reason };
    }
    if (this.state !== 'closed') {
      return { state: 'half-open', retryInMs: null, reason: this.reason };
    }
    return { state: 'closed', retryInMs: null };
  }

  private trip(cooldownMs: number, reason: CircuitReason): void {
    if (this.state !== 'open') {
      const why =
        reason === 'rate_limit'
          ? 'rate limited'
          : `${this.consecutiveFailures} consecutive failures`;
      console.warn(
        `[llm] circuit breaker opened for ${this.label} (${why}); cooling down for ${cooldownMs}ms`
      );
    }
    this.state = 'open';
    this.openedAt = Date.now();
    this.cooldownMs = cooldownMs;
    this.reason = reason;
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
