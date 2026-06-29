import {
  can as baseCan,
  type Capability,
  type Role,
  resolveAccessMatrix,
} from '@playwright-reports/shared';
import { configCache } from '../service/cache/config.js';

let cachedFrom: unknown;
let cachedMatrix: Record<Capability, readonly Role[]> | undefined;

export function getEffectiveAccessMatrix(): Record<Capability, readonly Role[]> {
  if (cachedMatrix && cachedFrom === configCache.config) return cachedMatrix;
  cachedMatrix = resolveAccessMatrix(configCache.config?.accessMatrix);
  cachedFrom = configCache.config;
  return cachedMatrix;
}

export function can(role: Role | null | undefined, capability: Capability): boolean {
  return baseCan(role, capability, getEffectiveAccessMatrix());
}
