import type { ReportFile, ReportTest } from '@playwright-reports/shared';

export interface TestGroup {
  label: string;
  tests: ReportTest[];
  problems: number;
}

export interface FileGroup {
  file: ReportFile;
  prefix: string[];
  groups: TestGroup[];
  problems: number;
}

export function testSeverityRank(outcome: ReportTest['outcome'] | undefined): number {
  if (outcome === 'unexpected' || outcome === 'failed') return 0;
  if (outcome === 'flaky') return 1;
  if (outcome === 'skipped') return 3;
  return 2;
}

export function isProblemTest(test: ReportTest): boolean {
  return testSeverityRank(test.outcome) <= 1;
}

function commonPrefix(paths: string[][]): string[] {
  if (paths.length === 0) return [];
  let prefix = paths[0];
  for (let index = 1; index < paths.length && prefix.length > 0; index++) {
    const path = paths[index];
    let shared = 0;
    while (shared < prefix.length && shared < path.length && prefix[shared] === path[shared]) {
      shared++;
    }
    prefix = prefix.slice(0, shared);
  }
  return prefix;
}

function compareTests(a: ReportTest, b: ReportTest): number {
  const bySeverity = testSeverityRank(a.outcome) - testSeverityRank(b.outcome);
  return bySeverity !== 0 ? bySeverity : (a.title ?? '').localeCompare(b.title ?? '');
}

export function buildFileGroup(file: ReportFile): FileGroup {
  const tests = file.tests ?? [];
  const prefix = commonPrefix(tests.map((test) => test.path ?? []));

  const byLabel = new Map<string, ReportTest[]>();
  for (const test of tests) {
    const label = (test.path ?? []).slice(prefix.length).join(' › ');
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(test);
    else byLabel.set(label, [test]);
  }

  const groups: TestGroup[] = [...byLabel.entries()]
    .map(([label, groupTests]) => ({
      label,
      tests: [...groupTests].sort(compareTests),
      problems: groupTests.filter(isProblemTest).length,
    }))
    .sort((a, b) => {
      const rankOf = (group: TestGroup) =>
        Math.min(...group.tests.map((test) => testSeverityRank(test.outcome)));
      const byRank = rankOf(a) - rankOf(b);
      return byRank !== 0 ? byRank : a.label.localeCompare(b.label);
    });

  return { file, prefix, groups, problems: tests.filter(isProblemTest).length };
}

export function buildFileGroups(files: ReportFile[] | undefined): FileGroup[] {
  return (files ?? []).map(buildFileGroup);
}
