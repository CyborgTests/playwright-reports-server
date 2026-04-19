import type { ReportFile, ReportHistory, ReportTest } from '@playwright-reports/shared';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { testStatusToColor } from '@/lib/tailwind';
import TestInfo from './test-info';

interface SuiteNode {
  name: string;
  children: SuiteNode[];
  tests: ReportTest[];
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
}

const SuiteNodeComponent = ({
  suite,
  history,
  reportId,
}: SuiteNodeComponentProps) => {
  return (
    <Accordion type="multiple" className="pl-4">
      {[
        ...suite.children.map((child) => (
          <AccordionItem key={child.name} value={child.name}>
            <AccordionTrigger className="hover:no-underline">{child.name}</AccordionTrigger>
            <AccordionContent>
              <SuiteNodeComponent
                history={history}
                reportId={reportId}
                suite={child}
              />
            </AccordionContent>
          </AccordionItem>
        )),
        ...suite.tests.map((test) => {
          const status = testStatusToColor(test.outcome || 'passed');

          return (
            <AccordionItem key={test.testId || 'unknown'} value={test.testId || 'unknown'}>
              <AccordionTrigger className="hover:no-underline">
                <span className="flex flex-row gap-4 flex-wrap items-center w-full justify-between pr-4">
                  <span className="flex items-center gap-2">
                    {`· ${test.title}`}
                    <Badge variant="outline" className={status.colorName}>
                      {status.title}
                    </Badge>
                    <Badge variant="secondary">{test.projectName || 'Unknown'}</Badge>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <TestInfo history={history} test={test} />
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
}

const FileSuitesTree = ({ file, history, reportId }: FileSuitesTreeProps) => {
  const suiteTree = buildTestTree(file.fileName || file.name || 'unknown', file.tests || []);

  return (
    <>
      <SuiteNodeComponent
        history={history}
        reportId={reportId}
        suite={suiteTree}
      />
    </>
  );
};

export default FileSuitesTree;
