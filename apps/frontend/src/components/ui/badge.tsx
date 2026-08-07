import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
        success: 'border border-success/30 bg-success-50 text-success-900',
        failure: 'border border-failure/30 bg-failure-50 text-failure-900',
        flaky: 'border border-flaky/30 bg-flaky-50 text-flaky-900',
        skipped: 'border-transparent bg-muted text-muted-foreground',
        running: 'border border-running/30 bg-running-50 text-running-900 animate-pulse',
        warning: 'border border-warning/30 bg-warning-50 text-warning-900',
        danger: 'border border-danger/30 bg-danger-50 text-danger-900',
        info: 'border border-info/30 bg-info-50 text-info-900',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  glow?: boolean;
}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(function Badge(
  { className, variant, glow, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant }), glow && 'shadow-glow', className)}
      {...props}
    />
  );
});

export { Badge, badgeVariants };
