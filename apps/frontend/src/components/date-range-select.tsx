import type { DateRange as SharedDateRange } from '@playwright-reports/shared';
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYesterday,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYesterday,
  subDays,
  subMonths,
} from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DateRange as PickerRange } from 'react-day-picker';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const STORAGE_KEY = 'selected-date-range';

type PresetId =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'this-month'
  | 'previous-month'
  | 'last-7-days'
  | 'last-2-weeks'
  | 'all';

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' },
  { id: 'last-7-days', label: 'Last 7 days' },
  { id: 'last-2-weeks', label: 'Last 2 weeks' },
  { id: 'this-month', label: 'This month' },
  { id: 'previous-month', label: 'Previous month' },
  { id: 'all', label: 'All time' },
];

function presetToRange(id: PresetId): SharedDateRange {
  const now = new Date();
  switch (id) {
    case 'today':
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case 'yesterday':
      return {
        from: startOfYesterday().toISOString(),
        to: endOfYesterday().toISOString(),
      };
    case 'this-week':
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
        to: endOfWeek(now, { weekStartsOn: 1 }).toISOString(),
      };
    case 'last-7-days':
      return {
        from: startOfDay(subDays(now, 6)).toISOString(),
        to: endOfDay(now).toISOString(),
      };
    case 'last-2-weeks':
      return {
        from: startOfDay(subDays(now, 13)).toISOString(),
        to: endOfDay(now).toISOString(),
      };
    case 'this-month':
      return {
        from: startOfMonth(now).toISOString(),
        to: endOfMonth(now).toISOString(),
      };
    case 'previous-month': {
      const prev = subMonths(now, 1);
      return {
        from: startOfMonth(prev).toISOString(),
        to: endOfMonth(prev).toISOString(),
      };
    }
    case 'all':
      return {};
  }
}

function rangeToLabel(range: SharedDateRange): string {
  if (!range.from && !range.to) return 'All time';
  const fmt = (iso: string) => format(new Date(iso), 'MMM d, yyyy');
  if (range.from && range.to) {
    if (range.from === range.to) return fmt(range.from);
    return `${fmt(range.from)} – ${fmt(range.to)}`;
  }
  if (range.from) return `From ${fmt(range.from)}`;
  if (range.to) return `Until ${fmt(range.to)}`;
  return 'All time';
}

type StoredSelection = { preset: PresetId } | SharedDateRange;

const PRESET_IDS = new Set<PresetId>(PRESETS.map((p) => p.id));

function isStoredPreset(value: unknown): value is { preset: PresetId } {
  return (
    !!value &&
    typeof value === 'object' &&
    'preset' in value &&
    PRESET_IDS.has((value as { preset: PresetId }).preset)
  );
}

export function readStoredDateRange(): SharedDateRange | null {
  try {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSelection;
    if (isStoredPreset(parsed)) return presetToRange(parsed.preset);
    return parsed as SharedDateRange;
  } catch {
    return null;
  }
}

function writeToStorage(value: StoredSelection) {
  try {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn('Failed to write date range to localStorage:', error);
  }
}

interface DateRangeSelectProps {
  selectedRange?: SharedDateRange;
  onSelect: (range: SharedDateRange) => void;
  label?: string;
  showLabel?: boolean;
  className?: string;
  /** Opt out of cross-page localStorage hydration & writes. Use on pages
   *  that should default to all-time and not influence other pages' default. */
  disablePersistence?: boolean;
}

export default function DateRangeSelect({
  selectedRange,
  onSelect,
  label = 'Period',
  showLabel = true,
  className = 'w-64 min-w-44',
  disablePersistence = false,
}: Readonly<DateRangeSelectProps>) {
  const [open, setOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [internalRange, setInternalRange] = useState<SharedDateRange>({});

  // Hydrate from localStorage if parent didn't seed a range. Parent (URL params) wins
  // when it provides a non-empty selectedRange. When `disablePersistence` is set,
  // skip localStorage entirely so the page defaults to all-time.
  useEffect(() => {
    if (isInitialized) return;
    if (selectedRange && (selectedRange.from || selectedRange.to)) {
      setInternalRange(selectedRange);
      setIsInitialized(true);
      return;
    }
    if (!disablePersistence) {
      const stored = readStoredDateRange();
      if (stored) {
        setInternalRange(stored);
        onSelect(stored);
      }
    }
    setIsInitialized(true);
  }, [isInitialized, selectedRange, onSelect, disablePersistence]);

  // Track parent-driven changes (e.g. URL navigation)
  useEffect(() => {
    if (!isInitialized) return;
    if (
      selectedRange &&
      (selectedRange.from !== internalRange.from || selectedRange.to !== internalRange.to)
    ) {
      setInternalRange(selectedRange);
    }
  }, [selectedRange, internalRange.from, internalRange.to, isInitialized]);

  const triggerLabel = useMemo(() => rangeToLabel(internalRange), [internalRange]);

  const applyRange = useCallback(
    (range: SharedDateRange, stored: StoredSelection) => {
      setInternalRange(range);
      if (!disablePersistence) writeToStorage(stored);
      onSelect(range);
    },
    [onSelect, disablePersistence]
  );

  const handlePreset = (id: PresetId) => {
    applyRange(presetToRange(id), { preset: id });
    setOpen(false);
  };

  const handleCalendarSelect = (picker: PickerRange | undefined) => {
    if (!picker?.from && !picker?.to) {
      applyRange({}, {});
      return;
    }
    const range: SharedDateRange = {
      from: picker.from ? startOfDay(picker.from).toISOString() : undefined,
      to: picker.to ? endOfDay(picker.to).toISOString() : undefined,
    };
    applyRange(range, range);
  };

  const calendarSelected: PickerRange | undefined = internalRange.from
    ? {
        from: new Date(internalRange.from),
        to: internalRange.to ? new Date(internalRange.to) : undefined,
      }
    : undefined;

  const labelId = 'date-range-select';

  return (
    <div className={showLabel ? 'flex flex-col gap-2' : ''}>
      {showLabel && (
        <Label htmlFor={labelId} className="text-sm font-medium">
          {label}
        </Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={labelId}
            variant="outline"
            className={`${className} justify-start text-left font-normal`}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            <span className="truncate">{triggerLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex flex-col sm:flex-row">
            <div className="flex flex-col gap-1 border-b sm:border-b-0 sm:border-r p-2 min-w-[140px]">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => handlePreset(preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="p-2">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={calendarSelected}
                onSelect={handleCalendarSelect}
                defaultMonth={calendarSelected?.from ?? new Date()}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
