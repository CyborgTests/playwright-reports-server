import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function ChartTooltip({ compact, children }: { compact?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'border bg-popover text-popover-foreground shadow-lg',
        compact ? 'rounded p-2 text-xs' : 'rounded-lg p-3'
      )}
    >
      {children}
    </div>
  );
}
