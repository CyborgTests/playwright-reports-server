import { ReportTestOutcomeEnum } from '@playwright-reports/shared';
import { Badge } from '@/components/ui/badge';

export function outcomeBadge(outcome?: string) {
  if (!outcome) return <span className="text-sm text-muted-foreground">—</span>;
  switch (outcome) {
    case ReportTestOutcomeEnum.Expected:
    case ReportTestOutcomeEnum.Passed:
      return <Badge variant="success">Passed</Badge>;
    case ReportTestOutcomeEnum.Flaky:
      return <Badge variant="warning">Flaky</Badge>;
    case ReportTestOutcomeEnum.Unexpected:
    case ReportTestOutcomeEnum.Failed:
      return <Badge variant="danger">Failed</Badge>;
    case ReportTestOutcomeEnum.Skipped:
      return <Badge variant="skipped">Skipped</Badge>;
    default:
      return <Badge variant="secondary">{outcome}</Badge>;
  }
}
