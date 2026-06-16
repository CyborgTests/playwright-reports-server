import type {
  ReportFile,
  ReportHistory,
  ReportStats,
  ReportTest,
} from '@playwright-reports/shared';
import { memo, useMemo } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { testStatusToColor } from '@/lib/tailwind';
import { pluralize } from '@/lib/transformers';
import TestInfo from './test-info';

interface SuiteNode {
  name: string;
  children: SuiteNode[];
  tests: ReportTest[];
}

function computeSuiteStats(suite: SuiteNode): ReportStats {
  const stats: Required<ReportStats> = {
    total: 0,
    expected: 0,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
    ok: true,
  };
  const visit = (node: SuiteNode) => {
    for (const test of node.tests) {
      stats.total++;
      switch (test.outcome) {
        case 'expected':
          stats.expected++;
          break;
        case 'flaky':
          stats.flaky++;
          break;
        case 'skipped':
          stats.skipped++;
          break;
        default:
          stats.unexpected++;
          stats.ok = false;
          break;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(suite);
  return stats;
}

export function StatsBadges({ stats }: { stats: ReportStats }) {
  if (!stats.total) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground font-normal flex-wrap">
      <span>
        {stats.total} {pluralize(stats.total, 'test')}
      </span>
      {(stats.expected ?? 0) > 0 && <Badge variant="success">{stats.expected} passed</Badge>}
      {(stats.unexpected ?? 0) > 0 && <Badge variant="danger">{stats.unexpected} failed</Badge>}
      {(stats.flaky ?? 0) > 0 && <Badge variant="warning">{stats.flaky} flaky</Badge>}
      {(stats.skipped ?? 0) > 0 && <Badge variant="secondary">{stats.skipped} skipped</Badge>}
    </span>
  );
}

function buildTestTree(rootName: string, tests: ReportTest[]): SuiteNode {
  const root: SuiteNode = { name: rootName, children: [], tests: [] };

  tests.forEach((test) => {
    const path = test.path || [];

    const noSuites = path.length === 0;

    if (noSuites) {
      root.tests.push(test);

      return;
    }

    const lastNodeIndex = path.length - 1;

    path.reduce((currentNode: SuiteNode, suiteName: string, index: number) => {
      const existingSuite = currentNode.children.find((child) => child.name === suiteName);

      const noMoreSuites = index === lastNodeIndex;

      if (noMoreSuites && existingSuite) {
        existingSuite.tests.push(test);
      }

      if (existingSuite) {
        return existingSuite;
      }

      const newSuite: SuiteNode = { name: suiteName, children: [], tests: [] };

      currentNode.children.push(newSuite);

      if (noMoreSuites) {
        newSuite.tests.push(test);
      }

      return newSuite;
    }, root);
  });

  return root;
}

interface SuiteNodeComponentProps {
  suite: SuiteNode;
  history: ReportHistory[];
  reportId?: string;
  project?: string;
  newRegressionTestIds?: Set<string>;
  resolvedRegressionTestIds?: Set<string>;
}

const SuiteNodeComponent = ({
  suite,
  history,
  reportId,
  project,
  newRegressionTestIds,
  resolvedRegressionTestIds,
}: SuiteNodeComponentProps) => {
  const childStats = useMemo(
    () => suite.children.map((child) => computeSuiteStats(child)),
    [suite]
  );

  return (
    <Accordion type="multiple" className="pl-4">
      {[
        ...suite.children.map((child, idx) => {
          const stats = childStats[idx];
          return (
            <AccordionItem key={child.name} value={child.name}>
              <AccordionTrigger className="hover:no-underline">
                <span className="flex flex-row gap-3 items-center w-full justify-between pr-4 flex-wrap">
                  <span className="font-medium">{child.name}</span>
                  <StatsBadges stats={stats} />
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <SuiteNodeComponent
                  history={history}
                  reportId={reportId}
                  suite={child}
                  project={project}
                  newRegressionTestIds={newRegressionTestIds}
                  resolvedRegressionTestIds={resolvedRegressionTestIds}
                />
              </AccordionContent>
            </AccordionItem>
          );
        }),
        ...suite.tests.map((test, testIdx) => {
          const status = testStatusToColor(test.outcome || 'passed');
          const isNewRegression = !!test.testId && newRegressionTestIds?.has(test.testId);
          const isResolvedRegression = !!test.testId && resolvedRegressionTestIds?.has(test.testId);
          const itemValue = test.testId || `test-${testIdx}`;

          return (
            <AccordionItem key={itemValue} value={itemValue}>
              <AccordionTrigger className="hover:no-underline">
                <span className="flex flex-row gap-4 flex-wrap items-center w-full justify-between pr-4">
                  <span className="flex items-center gap-2">
                    {`· ${test.title}`}
                    <Badge variant="outline" className={status.colorName}>
                      {status.title}
                    </Badge>
                    <Badge variant="secondary">{test.projectName || 'Unknown'}</Badge>
                    {isNewRegression && (
                      <Badge
                        variant="outline"
                        className="border-danger/40 text-danger"
                        title="This test newly regressed in this report"
                      >
                        regression
                      </Badge>
                    )}
                    {isResolvedRegression && (
                      <Badge
                        variant="outline"
                        className="border-success/40 text-success"
                        title="A prior regression for this test was resolved here"
                      >
                        resolved
                      </Badge>
                    )}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <TestInfo history={history} test={test} project={project} />
              </AccordionContent>
            </AccordionItem>
          );
        }),
      ]}
    </Accordion>
  );
};

interface FileSuitesTreeProps {
  file: ReportFile;
  history: ReportHistory[];
  reportId?: string;
  project?: string;
  newRegressionTestIds?: Set<string>;
  resolvedRegressionTestIds?: Set<string>;
}

const FileSuitesTreeImpl = ({
  file,
  history,
  reportId,
  project,
  newRegressionTestIds,
  resolvedRegressionTestIds,
}: FileSuitesTreeProps) => {
  const suiteTree = useMemo(
    () => buildTestTree(file.fileName || file.name || 'unknown', file.tests || []),
    [file]
  );

  return (
    <SuiteNodeComponent
      history={history}
      reportId={reportId}
      suite={suiteTree}
      project={project}
      newRegressionTestIds={newRegressionTestIds}
      resolvedRegressionTestIds={resolvedRegressionTestIds}
    />
  );
};

const FileSuitesTree = memo(FileSuitesTreeImpl);
export default FileSuitesTree;
