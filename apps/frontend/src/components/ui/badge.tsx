import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
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
        success: 'border-transparent bg-success text-success-foreground shadow-sm',
        failure: 'border-transparent bg-failure text-failure-foreground shadow-sm',
        flaky: 'border-transparent bg-flaky text-flaky-foreground shadow-sm',
        skipped: 'border-transparent bg-muted text-muted-foreground',
        running: 'border-transparent bg-running text-running-foreground animate-pulse',
        warning: 'border-transparent bg-warning text-warning-foreground shadow-sm',
        danger: 'border-transparent bg-danger text-danger-foreground shadow-sm',
        info: 'border-transparent bg-info text-info-foreground shadow-sm',
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

function Badge({ className, variant, glow, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), glow && 'shadow-glow', className)} {...props} />
  );
}

export { Badge, badgeVariants };
