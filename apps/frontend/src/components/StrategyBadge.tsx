import type { LlmTaskType } from '@playwright-reports/shared';
import { describeStrategy } from '@playwright-reports/shared';
import { Badge } from '@/components/ui/badge';
import { useConfig } from '@/hooks/useConfig';

export function StrategyBadge({
  taskType,
  className,
}: Readonly<{ taskType: LlmTaskType; className?: string }>) {
  const { data: config } = useConfig();
  const routing = config?.llm?.routing?.[taskType];
  const strategy = routing?.strategy ?? 'one_shot';
  if (strategy === 'one_shot') return null;
  return (
    <Badge
      variant="outline"
      className={className}
      title="LLM routing strategy used to produce this analysis"
    >
      {describeStrategy(routing)}
    </Badge>
  );
}
