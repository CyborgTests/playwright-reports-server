import { formatRelativeTime } from '@playwright-reports/shared';

export type DateDisplayMode = 'datetime' | 'date' | 'time';

const MODE_OPTIONS: Record<DateDisplayMode, Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
};

function toDate(input: Date | string | number): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function timeZoneAbbr(d: Date): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

export function formatDate(
  input: Date | string | number,
  mode: DateDisplayMode = 'datetime',
  options?: { showTimezone?: boolean }
): string {
  const d = toDate(input);
  if (!d) return '';
  const base = d.toLocaleString(undefined, MODE_OPTIONS[mode]);
  if (!options?.showTimezone) return base;
  const tz = timeZoneAbbr(d);
  return tz ? `${base} ${tz}` : base;
}

export function formatDateTooltip(input: Date | string | number): string {
  const d = toDate(input);
  if (!d) return '';
  const abs = d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
  const rel = formatRelativeTime(d.getTime());
  return rel ? `${abs} · ${rel}` : abs;
}
