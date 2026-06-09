import type { Grade, GradeBands, GradeFormula, QualityNodeStats } from '../types/quality.js';
import { GRADE_ORDER } from '../types/quality.js';

export const DEFAULT_GRADE_BANDS: GradeBands = { S: 99, A: 95, B: 90, C: 80, D: 70 };

export function normalizeStats(stats: {
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
  passed?: number;
  failed?: number;
  total?: number;
}): QualityNodeStats {
  const passed = stats.passed ?? stats.expected ?? 0;
  const failed = stats.failed ?? stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  const total = stats.total ?? passed + failed + flaky + skipped;
  return { passed, failed, flaky, skipped, total };
}

export function computePassRate(stats: QualityNodeStats, formula: GradeFormula): number {
  const denom = stats.passed + stats.failed + stats.flaky;
  if (denom <= 0) return 0;
  const numerator = formula === 'strict' ? stats.passed : stats.passed + stats.flaky;
  return (numerator / denom) * 100;
}

export function gradeFor(passRate: number, bands: GradeBands): Grade {
  if (passRate >= bands.S) return 'S';
  if (passRate >= bands.A) return 'A';
  if (passRate >= bands.B) return 'B';
  if (passRate >= bands.C) return 'C';
  if (passRate >= bands.D) return 'D';
  return 'F';
}

export function gradeRank(grade: Grade): number {
  return GRADE_ORDER.length - 1 - GRADE_ORDER.indexOf(grade);
}

export function isVerdictOk(grade: Grade, minOkGrade: Grade): boolean {
  return gradeRank(grade) >= gradeRank(minOkGrade);
}

export interface WeightedValue {
  value: number;
  weight: number;
}

export function weightedAverage(values: WeightedValue[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const { value, weight } of values) {
    if (weight <= 0) continue;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

export function formatPassRate(passRate: number): string {
  const rounded = Math.round(passRate * 10) / 10;
  return `${rounded.toFixed(1).replace(/\.0$/, '')}%`;
}
