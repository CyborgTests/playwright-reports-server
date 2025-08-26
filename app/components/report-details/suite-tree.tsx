import { Accordion, AccordionItem, Chip, Button } from '@heroui/react';
import { useState } from 'react';

import JiraTicketModal from '../jira-ticket-modal';

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

interface SuiteNodeComponentProps {
  suite: SuiteNode;
  history: ReportHistory[];
  onCreateJiraTicket: (test: ReportTest) => void;
}

const SuiteNodeComponent = ({ suite, history, onCreateJiraTicket }: SuiteNodeComponentProps) => {
  return (
    <Accordion key={suite.name} aria-label={suite.name} selectionMode="multiple" title={suite.name}>
      {[
        ...suite.children.map((child) => (
          <AccordionItem key={child.name} aria-label={child.name} className="p-2" title={`${child.name}`}>
            <SuiteNodeComponent history={history} suite={child} onCreateJiraTicket={onCreateJiraTicket} />
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
                <span className="flex flex-row gap-4 flex-wrap items-center">
                  {`· ${test.title}`}
                  <Chip color={status.colorName} size="sm">
                    {status.title}
                  </Chip>
                  <Chip color="default" size="sm">
                    {test.projectName}
                  </Chip>
                  <Button
                    className="ml-auto"
                    color="primary"
                    size="sm"
                    title="Create Jira ticket for this failed test"
                    variant="flat"
                    onPress={() => onCreateJiraTicket(test)}
                  >
                    Create Jira Ticket
                  </Button>
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

interface FileSuitesTreeProps {
  file: ReportFile;
  history: ReportHistory[];
  reportId?: string;
}

const FileSuitesTree = ({ file, history, reportId }: FileSuitesTreeProps) => {
  const [selectedTest, setSelectedTest] = useState<ReportTest | null>(null);
  const [isJiraModalOpen, setIsJiraModalOpen] = useState(false);

  const handleCreateJiraTicket = (test: ReportTest) => {
    setSelectedTest(test);
    setIsJiraModalOpen(true);
  };

  const suiteTree = buildTestTree(file.fileName, file.tests);

  return (
    <>
      <SuiteNodeComponent history={history} suite={suiteTree} onCreateJiraTicket={handleCreateJiraTicket} />

      <JiraTicketModal
        isOpen={isJiraModalOpen}
        reportId={reportId}
        test={selectedTest}
        onOpenChange={setIsJiraModalOpen}
      />
    </>
  );
};

export default FileSuitesTree;
