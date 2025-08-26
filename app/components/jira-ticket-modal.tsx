'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
  Select,
  SelectItem,
} from '@heroui/react';
import { toast } from 'sonner';

import { type ReportTest } from '@/app/lib/parser';

interface JiraTicketModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  test: ReportTest | null;
  reportId?: string;
}

interface JiraTicketData {
  summary: string;
  description: string;
  issueType: string;
  projectKey: string;
}

export default function JiraTicketModal({ isOpen, onOpenChange, test, reportId }: JiraTicketModalProps) {
  const [ticketData, setTicketData] = useState<JiraTicketData>({
    summary: '',
    description: '',
    issueType: 'Bug',
    projectKey: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jiraConfig, setJiraConfig] = useState<any>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  useEffect(() => {
    const loadJiraConfig = async () => {
      try {
        const response = await fetch('/api/jira/config');
        const config = await response.json();

        setJiraConfig(config);

        if (config.configured && config.defaultProjectKey && !ticketData.projectKey) {
          setTicketData((prev) => ({ ...prev, projectKey: config.defaultProjectKey }));
        }

        if (config.configured) {
          const newDefaults: Partial<JiraTicketData> = {};

          if (config.issueTypes?.length > 0 && ticketData.issueType === 'Bug') {
            newDefaults.issueType = config.issueTypes[0].name;
          }

          if (Object.keys(newDefaults).length > 0) {
            setTicketData((prev) => ({ ...prev, ...newDefaults }));
          }
        }
      } catch (error) {
        console.error('Failed to load Jira configuration:', error);
      } finally {
        setIsLoadingConfig(false);
      }
    };

    if (isOpen) {
      loadJiraConfig();
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!test) return;

    setIsSubmitting(true);

    try {
      const testAttachments =
        test.results?.[0]?.attachments?.map((att: any) => ({
          name: att.name,
          path: att.path,
          contentType: att.contentType,
        })) || [];

      const requestData = {
        ...ticketData,
        testId: test.testId,
        testTitle: test.title,
        testOutcome: test.outcome,
        testLocation: test.location,
        testAttachments,
        reportId: reportId,
      };

      const response = await fetch('/api/jira/create-ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create Jira ticket');
      }

      toast.success(`Jira ticket created: ${result.issueKey}`);
      onOpenChange(false);

      setTicketData({
        summary: '',
        description: '',
        issueType: 'Bug',
        projectKey: ticketData.projectKey, // Keep the current project key
      });
    } catch (error) {
      toast.error(`Failed to create Jira ticket: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateDefaultSummary = () => {
    if (!test) return '';

    return `Test Failed: ${test.title}`;
  };

  const generateDefaultDescription = () => {
    if (!test) return '';

    return `Test Failure Details
      Test: ${test.title}
      Project: ${test.projectName}
      Location: ${test.location.file}:${test.location.line}
      Test ID: ${test.testId}

      Steps to Reproduce:
      1. Run the test suite
      2. Test "${test.title}" fails

      Expected Behavior:
      Test should pass

      Actual Behavior:
      Test is failing

      Additional Information:
      - Duration: ${test.duration}ms
      - Tags: ${test.tags.join(', ') || 'None'}
      - Annotations: ${test.annotations.join(', ') || 'None'}`;
  };

  // Auto-populate form when test changes
  if (test && (!ticketData.summary || ticketData.summary === '')) {
    setTicketData((prev) => ({
      ...prev,
      summary: generateDefaultSummary(),
      description: generateDefaultDescription(),
    }));
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">Create Jira Ticket</ModalHeader>
            <ModalBody>
              {isLoadingConfig ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Loading Jira configuration...</p>
                  </div>
                </div>
              ) : !jiraConfig?.configured ? (
                <div className="text-center py-8">
                  <div className="text-red-500 mb-4">
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Jira Not Configured</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {jiraConfig?.message || 'Jira integration is not properly configured.'}
                  </p>
                  <div className="bg-gray-50 p-4 rounded-lg text-left">
                    <p className="text-sm font-medium mb-2">Required Environment Variables:</p>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• JIRA_BASE_URL</li>
                      <li>• JIRA_EMAIL</li>
                      <li>• JIRA_API_TOKEN</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <Input
                    isRequired
                    label="Summary"
                    placeholder="Brief description of the issue"
                    value={ticketData.summary}
                    onValueChange={(value) => setTicketData((prev) => ({ ...prev, summary: value }))}
                  />
                  <Textarea
                    label="Description"
                    minRows={6}
                    placeholder="Detailed description of the issue"
                    value={ticketData.description}
                    onValueChange={(value) => setTicketData((prev) => ({ ...prev, description: value }))}
                  />
                  <div className="flex gap-4">
                    <Select
                      label="Issue Type"
                      placeholder="Select issue type"
                      selectedKeys={[ticketData.issueType]}
                      onSelectionChange={(keys) => {
                        const issueType = Array.from(keys)[0] as string;

                        setTicketData((prev) => ({ ...prev, issueType }));
                      }}
                    >
                      {jiraConfig?.issueTypes?.map((issueType: any) => (
                        <SelectItem key={issueType.name}>{issueType.name}</SelectItem>
                      )) || (
                        <>
                          <SelectItem key="Bug">Bug</SelectItem>
                          <SelectItem key="Task">Task</SelectItem>
                          <SelectItem key="Story">Story</SelectItem>
                        </>
                      )}
                    </Select>
                  </div>
                  <Input
                    isRequired
                    label="Project Key"
                    placeholder="e.g., PROJ"
                    value={ticketData.projectKey}
                    onValueChange={(value) => setTicketData((prev) => ({ ...prev, projectKey: value }))}
                  />
                  {test?.results?.[0]?.attachments && test.results[0].attachments.length > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="text-blue-600">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </div>
                      <div className="text-sm">
                        <div className="font-medium text-blue-800">
                          {test.results[0].attachments.length} test attachment(s) will be included
                        </div>
                        <div className="text-blue-600">
                          {test.results[0].attachments.map((att: any) => att.name).join(', ')}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button color="primary" variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button
                color="primary"
                isDisabled={!jiraConfig?.configured || !ticketData.summary || !ticketData.projectKey}
                isLoading={isSubmitting}
                onPress={handleSubmit}
              >
                Create Ticket
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
