
import { Accordion, AccordionItem, Chip } from '@heroui/react';
import TestInfo from './test-info';

import { type ReportFile, type ReportTest } from '@/app/lib/parser';
import { type ReportHistory } from '@/app/lib/storage';
import { testStatusToColor } from '@/app/lib/tailwind';

interface SuiteNode {
  name: string;
  children: SuiteNode[];
  tests: ReportTest[];
}

function buildTestTree(rootName: string, tests: ReportTest[]): SuiteNode {
  const root: SuiteNode = { name: rootName, children: [], tests: [] };

  tests.forEach((test) => {
    const { path } = test;

    const noSuites = path.length === 0;

    if (noSuites) {
      root.tests.push(test);

      return;
    }

    const lastNodeIndex = path.length - 1;

    path.reduce((currentNode, suiteName, index) => {
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

const renderSuiteNode = (suite: SuiteNode, history: ReportHistory[]) => {
  return (
    <Accordion key={suite.name} aria-label={suite.name} selectionMode="multiple" title={suite.name}>
      {[
        ...suite.children.map((child) => (
          <AccordionItem key={child.name} aria-label={child.name} className="p-2" title={`${child.name}`}>
            {renderSuiteNode(child, history)}
          </AccordionItem>
        )),
        ...suite.tests.map((test) => {
          const status = testStatusToColor(test.outcome);

          return (
            <AccordionItem
              key={test.testId}
              aria-label={test.title}
              className="p-2"
              title={
                <span className="flex flex-row gap-4 flex-wrap">
                  {`· ${test.title}`}
                  <Chip color={status.colorName} size="sm">
                    {status.title}
                  </Chip>
                  <Chip color="default" size="sm">
                    {test.projectName}
                  </Chip>
                </span>
              }
            >
              <TestInfo history={history} test={test} />
            </AccordionItem>
          );
        }),
      ]}
    </Accordion>
  );
};

const renderFileSuitesTree = (file: ReportFile, history: ReportHistory[]) =>
  renderSuiteNode(buildTestTree(file.fileName, file.tests), history);

export default renderFileSuitesTree;
