import { cn } from '@/lib/utils';

export function title({ className }: { className?: string } = {}) {
  return cn('font-display font-bold tracking-tight text-3xl md:text-4xl', className);
}

export function subtitle({ className }: { className?: string } = {}) {
  return cn('text-muted-foreground text-lg', className);
}

export function description({ className }: { className?: string } = {}) {
  return cn('text-sm text-muted-foreground', className);
}
