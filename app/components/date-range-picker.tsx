'use client';

import { DateRangePicker as HeroUIDateRangePicker } from '@heroui/react';
import { useCallback, useMemo } from 'react';
import { CalendarDateTime } from '@internationalized/date';
import { I18nProvider } from '@react-aria/i18n';

interface DateRangePickerProps {
  dateFrom?: string;
  dateTo?: string;
  label?: string;
  onDateFromChange?: (date: string) => void;
  onDateToChange?: (date: string) => void;
}

export default function DateRangePicker({
  dateFrom,
  dateTo,
  label = 'Date Range',
  onDateFromChange,
  onDateToChange,
}: Readonly<DateRangePickerProps>) {
  // Convert ISO strings to CalendarDateTime for HeroUI DateRangePicker (includes time fields)
  const defaultValue = useMemo(() => {
    if (!dateFrom || !dateTo) return undefined;

    try {
      // Parse ISO strings and convert to CalendarDateTime (includes time)
      const startDate = new Date(dateFrom);
      const endDate = new Date(dateTo);

      // Create CalendarDateTime objects with time
      const start = new CalendarDateTime(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        startDate.getDate(),
        startDate.getHours(),
        startDate.getMinutes(),
      );
      const end = new CalendarDateTime(
        endDate.getFullYear(),
        endDate.getMonth() + 1,
        endDate.getDate(),
        endDate.getHours(),
        endDate.getMinutes(),
      );

      return { start, end };
    } catch {
      return undefined;
    }
  }, [dateFrom, dateTo]);

  const handleChange = useCallback(
    (range: { start: any; end: any } | null) => {
      if (!range) {
        onDateFromChange?.('');
        onDateToChange?.('');

        return;
      }

      if (range.start && onDateFromChange) {
        // Convert CalendarDateTime to ISO string
        const year = range.start.year;
        const month = String(range.start.month).padStart(2, '0');
        const day = String(range.start.day).padStart(2, '0');
        const hour = String(range.start.hour).padStart(2, '0');
        const minute = String(range.start.minute).padStart(2, '0');
        const isoString = `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;

        onDateFromChange(isoString);
      } else if (!range.start && onDateFromChange) {
        onDateFromChange('');
      }

      if (range.end && onDateToChange) {
        // Convert CalendarDateTime to ISO string
        const year = range.end.year;
        const month = String(range.end.month).padStart(2, '0');
        const day = String(range.end.day).padStart(2, '0');
        const hour = String(range.end.hour).padStart(2, '0');
        const minute = String(range.end.minute).padStart(2, '0');
        const isoString = `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;

        onDateToChange(isoString);
      } else if (!range.end && onDateToChange) {
        onDateToChange('');
      }
    },
    [onDateFromChange, onDateToChange],
  );

  return (
    <I18nProvider locale="en-GB">
      <HeroUIDateRangePicker
        hideTimeZone
        className="w-[350px]"
        defaultValue={defaultValue as any}
        granularity="minute"
        label={label}
        labelPlacement="outside"
        variant="bordered"
        onChange={handleChange}
      />
    </I18nProvider>
  );
}
