export type PassRateVariant = 'success' | 'warning' | 'danger';

export const PASS_RATE_SUCCESS_THRESHOLD = 95;
export const PASS_RATE_WARNING_THRESHOLD = 70;

export function passRateVariant(value: number): PassRateVariant {
  if (value >= PASS_RATE_SUCCESS_THRESHOLD) return 'success';
  if (value >= PASS_RATE_WARNING_THRESHOLD) return 'warning';
  return 'danger';
}
