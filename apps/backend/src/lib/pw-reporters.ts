import { existsSync } from 'node:fs';
import path from 'node:path';
import { CWD } from './storage/constants.js';

export interface ReporterValidationResult {
  valid: string[];
  missing: { input: string; resolved: string }[];
}

const resolveReporterPath = (raw: string): string => {
  return path.isAbsolute(raw) ? raw : path.resolve(CWD, raw);
};

export const normalizeReporterPaths = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
};

export const validateReporterPaths = (paths: string[]): ReporterValidationResult => {
  const valid: string[] = [];
  const missing: { input: string; resolved: string }[] = [];
  for (const input of paths) {
    const resolved = resolveReporterPath(input);
    if (existsSync(resolved)) {
      valid.push(resolved);
    } else {
      missing.push({ input, resolved });
    }
  }
  return { valid, missing };
};
