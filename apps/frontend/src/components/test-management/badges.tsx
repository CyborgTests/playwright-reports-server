import type { TestWithQuarantineInfo } from '@playwright-reports/shared';
import { Badge } from '@/components/ui/badge';

export function formatRegressionAge(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${Math.round(days * 10) / 10}d`;
}

export function getStatusBadge(
  test: TestWithQuarantineInfo,
  warningThreshold: number,
  quarantineThreshold: number
) {
  if (test.isQuarantined) {
    return (
      <Badge variant="destructive" className="gap-1">
        🔒 Quarantined
      </Badge>
    );
  }
  if (test.flakinessScore === undefined) {
    return <Badge variant="secondary">No Data</Badge>;
  }
  if (test.flakinessScore < warningThreshold) {
    return (
      <Badge variant="success" className="gap-1">
        Stable
      </Badge>
    );
  }
  if (test.flakinessScore < quarantineThreshold) {
    return (
      <Badge variant="warning" className="gap-1">
        Flaky
      </Badge>
    );
  }
  return (
    <Badge variant="danger" className="gap-1">
      Critical
    </Badge>
  );
}
