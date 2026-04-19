'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCategoryName } from '@/lib/format';

interface ErrorGroup {
  message: string;
  category: string;
  count: number;
  signature: string;
}

interface TopFailuresWidgetProps {
  errors?: ErrorGroup[];
  isLoading?: boolean;
}

const categoryVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  timeout: 'secondary',
  assertion_error: 'destructive',
  element_not_found: 'outline',
  network_error: 'destructive',
  unknown: 'outline',
};

export function TopFailuresWidget({ errors, isLoading }: Readonly<TopFailuresWidgetProps>) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const topErrors = (errors ?? []).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Most Common Failures</h3>
        <p className="text-sm text-muted-foreground">
          Top error patterns across recent reports
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : topErrors.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No failure data available
          </div>
        ) : (
          <div className="space-y-3">
            {topErrors.map((error, index) => (
              <div
                key={error.signature}
                className="border rounded-lg p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setExpandedIndex(expandedIndex === index ? null : index);
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant={categoryVariant[error.category] ?? 'outline'}>
                      {formatCategoryName(error.category)}
                    </Badge>
                    <span className="text-sm text-muted-foreground truncate">
                      {error.message.substring(0, 100)}
                      {error.message.length > 100 ? '...' : ''}
                    </span>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {error.count}x
                  </Badge>
                </div>
                {expandedIndex === index && (
                  <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
                    {error.message}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
